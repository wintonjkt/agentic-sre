'use strict';
const express = require('express');
const chokidar = require('chokidar');
const { marked } = require('marked');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const PORT        = process.env.PORT         || 3000;
const WORKSPACE   = process.env.WORKSPACE_DIR || '/workspace';
const NAMESPACE   = process.env.OCP_NAMESPACE || 'sre-demo';
const OCP_API_URL = process.env.OCP_API_URL   || '';
const MANIFESTS   = '/manifests';

// In-cluster auth for oc commands
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SA_CA_PATH    = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

function ocAuth() {
  if (!OCP_API_URL) return '';
  const token = fs.existsSync(SA_TOKEN_PATH) ? fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim() : '';
  if (!token) return '';
  return `--token=${token} --server=${OCP_API_URL} --insecure-skip-tls-verify=true`;
}

// ── SSE client registry ────────────────────────────────────────────────────
let clients = [];

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach(res => { try { res.write(data); } catch (_) {} });
}

// ── Agent definitions ──────────────────────────────────────────────────────
const AGENT_FILES = {
  'instana-query':   'instana-findings.json',
  'instana-rca':     'instana-rca.json',
  'openshift-check': 'ocp-findings.json',
  'infra-check':     'infra-findings.json',
  'rca-aggregator':  'rca-report.md',
};

const LOG_FILES = {
  'instana-query':   'instana-query.log',
  'instana-rca':     'instana-rca.log',
  'openshift-check': 'openshift-check.log',
  'infra-check':     'infra-check.log',
  'rca-aggregator':  'rca-aggregator.log',
};

const AGENT_META = {
  'instana-query':   { label: 'Instana Query',    domain: 'Observability',  color: '#0f62fe' },
  'instana-rca':     { label: 'Instana RCA',       domain: 'Analysis',       color: '#0f62fe' },
  'openshift-check': { label: 'OpenShift Health',  domain: 'Platform',       color: '#ee5396' },
  'infra-check':     { label: 'Infra Check',        domain: 'Infrastructure', color: '#42be65' },
  'rca-aggregator':  { label: 'RCA Aggregator',     domain: 'Synthesis',      color: '#ff832b' },
};

// ── Log file tail state ────────────────────────────────────────────────────
// Track byte offset per log file so we only broadcast NEW lines on change.
const logOffsets = {};

// ── Parse agent findings file ──────────────────────────────────────────────
function parseAgentFile(agentId, filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (filePath.endsWith('.md')) {
      const match = raw.match(/<!--\s*completed_at:\s*([^\s-][^>]*?)\s*-->/);
      return {
        status: match ? 'success' : 'running',
        completed_at: match ? match[1].trim() : null,
        summary: 'RCA report and Ansible playbook generated',
        raw,
      };
    }
    const obj = JSON.parse(raw);
    return {
      status:       obj.status       || 'unknown',
      completed_at: obj.completed_at || null,
      summary:      obj.summary      || '',
      simulated:    obj.simulated    || false,
      raw,
    };
  } catch (_) {
    return { status: 'running', summary: '', raw: '' };
  }
}

// ── Broadcast new log lines from a log file ────────────────────────────────
function broadcastNewLogLines(agentId, filePath) {
  try {
    const stat = fs.statSync(filePath);
    const prevOffset = logOffsets[agentId] || 0;
    if (stat.size <= prevOffset) return;

    const fd = fs.openSync(filePath, 'r');
    const chunk = Buffer.alloc(stat.size - prevOffset);
    fs.readSync(fd, chunk, 0, chunk.length, prevOffset);
    fs.closeSync(fd);
    logOffsets[agentId] = stat.size;

    const text = chunk.toString('utf8');
    const lines = text.split('\n');
    const ts = new Date().toISOString();
    lines.forEach(line => {
      if (line.trim()) {
        broadcast({ type: 'pod_log', agentId, line, ts });
      }
    });
  } catch (_) {}
}

// ── Chokidar workspace watcher ─────────────────────────────────────────────
const watcher = chokidar.watch(WORKSPACE, {
  usePolling: true,
  interval: 1000,
  ignored: /(^|[/\\])\../,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 150 },
});

watcher.on('add',    fp => handleFileChange('add',    fp));
watcher.on('change', fp => handleFileChange('change', fp));

function handleFileChange(event, filePath) {
  const basename = path.basename(filePath);

  // Handle findings JSON / RCA markdown
  const agentId = Object.entries(AGENT_FILES).find(([, f]) => f === basename)?.[0];
  if (agentId) {
    const parsed = parseAgentFile(agentId, filePath);
    broadcast({ type: 'agent_update', agentId, ...parsed });
    console.log(`[dashboard] ${event}: ${basename} → status=${parsed.status}`);
    return;
  }

  // Handle log files
  const logAgentId = Object.entries(LOG_FILES).find(([, f]) => f === basename)?.[0];
  if (logAgentId) {
    broadcastNewLogLines(logAgentId, filePath);
  }
}

// ── SSE endpoint ──────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Immediately send current state of all findings files
  Object.entries(AGENT_FILES).forEach(([agentId, filename]) => {
    const fp = path.join(WORKSPACE, filename);
    if (fs.existsSync(fp)) {
      const parsed = parseAgentFile(agentId, fp);
      res.write(`data: ${JSON.stringify({ type: 'agent_update', agentId, ...parsed })}\n\n`);
    }
  });

  // Send last 50 lines of any existing log files
  Object.entries(LOG_FILES).forEach(([agentId, filename]) => {
    const fp = path.join(WORKSPACE, filename);
    if (fs.existsSync(fp)) {
      try {
        const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).slice(-50);
        const ts = new Date().toISOString();
        lines.forEach(line => {
          res.write(`data: ${JSON.stringify({ type: 'pod_log', agentId, line, ts })}\n\n`);
        });
      } catch (_) {}
    }
  });

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 15000);

  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
    clearInterval(heartbeat);
  });
});

// ── Pipeline status snapshot ──────────────────────────────────────────────
app.get('/api/pipeline-status', (req, res) => {
  const agents = {};
  Object.entries(AGENT_FILES).forEach(([agentId, filename]) => {
    const fp = path.join(WORKSPACE, filename);
    const logFp = path.join(WORKSPACE, LOG_FILES[agentId] || '');
    const hasFindings = fs.existsSync(fp);
    const hasLog      = fs.existsSync(logFp);
    const parsed      = hasFindings ? parseAgentFile(agentId, fp) : null;
    agents[agentId] = {
      status:      parsed?.status || 'waiting',
      hasFindings,
      hasLog,
      summary:     parsed?.summary || '',
      completed_at: parsed?.completed_at || null,
    };
  });
  res.json({ agents, workspace: WORKSPACE });
});

// ── Reset endpoint — clears workspace without relaunching jobs ────────────
app.post('/api/reset', (req, res) => {
  res.status(202).json({ status: 'accepted', message: 'Workspace reset started…' });

  const ns   = NAMESPACE;
  const auth = ocAuth();

  async function doReset() {
    function run(cmd) {
      return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout.trim());
        });
      });
    }
    try {
      broadcast({ type: 'pipeline_event', phase: 'reset', message: 'Workspace reset requested from launcher…', ts: new Date().toISOString() });
      await run(`oc delete jobs -l app=agentic-sre -n ${ns} --ignore-not-found ${auth} 2>&1 || true`);
      await run(
        `oc run workspace-reset-${Date.now()} --image=busybox:1.36 --restart=Never -n ${ns} ${auth} ` +
        `--overrides='{"spec":{"volumes":[{"name":"ws","persistentVolumeClaim":{"claimName":"sre-workspace"}}],"containers":[{"name":"reset","image":"busybox:1.36","command":["sh","-c","rm -rf /workspace/*.json /workspace/*.md /workspace/*.log && echo cleared"],"volumeMounts":[{"name":"ws","mountPath":"/workspace"}]}],"restartPolicy":"Never"}}' ` +
        `--wait --timeout=30s 2>/dev/null || true`
      );
      await run(`oc delete pods --field-selector=status.phase==Succeeded -n ${ns} ${auth} --ignore-not-found 2>/dev/null || true`);
      Object.keys(logOffsets).forEach(k => delete logOffsets[k]);
      broadcast({ type: 'pipeline_event', phase: 'reset', message: 'Workspace cleared ✓', ts: new Date().toISOString() });
    } catch (err) {
      broadcast({ type: 'pipeline_event', phase: 'error', message: `Reset failed: ${err.message}`, ts: new Date().toISOString() });
    }
  }

  doReset();
});

// ── Trigger endpoint ──────────────────────────────────────────────────────
app.post('/api/trigger', (req, res) => {
  res.status(202).json({ status: 'accepted', message: 'Investigation starting…' });

  const ns = NAMESPACE;
  const ts = () => new Date().toISOString();

  function broadcastPhase(phase, message) {
    broadcast({ type: 'pipeline_event', phase, message, ts: ts() });
    console.log(`[trigger] ${phase}: ${message}`);
  }

  function run(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      });
    });
  }

  async function launchPipeline() {
    try {
      const auth = ocAuth();
      broadcastPhase('reset', 'Deleting previous jobs…');
      await run(`oc delete jobs -l app=agentic-sre -n ${ns} --ignore-not-found ${auth} 2>&1 || true`);

      broadcastPhase('reset', 'Clearing workspace…');
      await run(
        `oc run workspace-reset-${Date.now()} --image=busybox:1.36 --restart=Never -n ${ns} ${auth} ` +
        `--overrides='{"spec":{"volumes":[{"name":"ws","persistentVolumeClaim":{"claimName":"sre-workspace"}}],"containers":[{"name":"reset","image":"busybox:1.36","command":["sh","-c","rm -rf /workspace/*.json /workspace/*.md /workspace/*.log && echo cleared"],"volumeMounts":[{"name":"ws","mountPath":"/workspace"}]}],"restartPolicy":"Never"}}' ` +
        `--wait --timeout=30s 2>/dev/null || true`
      );
      // Clean up reset pod
      await run(`oc delete pods --field-selector=status.phase==Succeeded -n ${ns} ${auth} --ignore-not-found 2>/dev/null || true`);

      // Reset log offsets so new lines are picked up from offset 0
      Object.keys(logOffsets).forEach(k => delete logOffsets[k]);

      broadcastPhase('launching', 'Launching 4 parallel SRE agent jobs…');
      const jobFiles = [
        'job-instana-query.yaml',
        'job-instana-rca.yaml',
        'job-openshift-check.yaml',
        'job-infra-check.yaml',
      ];
      for (const f of jobFiles) {
        await run(`oc apply -f ${path.join(MANIFESTS, f)} -n ${ns} ${auth} 2>&1`);
        broadcastPhase('launching', `Applied ${f}`);
      }

      broadcastPhase('launching', 'Launching RCA aggregator…');
      await run(`oc apply -f ${path.join(MANIFESTS, 'job-aggregator.yaml')} -n ${ns} ${auth} 2>&1`);

      broadcastPhase('running', 'All 5 agent jobs launched. Monitoring workspace for results…');
    } catch (err) {
      broadcastPhase('error', `Pipeline launch failed: ${err.message}`);
      console.error('[trigger] ERROR:', err);
    }
  }

  // Run asynchronously — response already sent
  launchPipeline();
});

// ── Agent findings detail ─────────────────────────────────────────────────
// Returns parsed findings for a given agent with the full raw JSON.
app.get('/api/findings/:agentId', (req, res) => {
  const { agentId } = req.params;
  const filename = AGENT_FILES[agentId];
  if (!filename) return res.status(404).json({ error: 'unknown agent' });
  const fp = path.join(WORKSPACE, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not ready' });
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (filename.endsWith('.md')) {
      return res.json({ agentId, type: 'markdown', raw });
    }
    const obj = JSON.parse(raw);
    return res.json({ agentId, type: 'json', raw: obj });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Serve workspace files ─────────────────────────────────────────────────
app.get('/workspace/:file', (req, res) => {
  const safe = path.basename(req.params.file);
  const fp = path.join(WORKSPACE, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', safe.endsWith('.json') ? 'application/json' : 'text/plain');
  res.send(fs.readFileSync(fp, 'utf8'));
});

// ── Rendered RCA report ───────────────────────────────────────────────────
app.get('/report', (req, res) => {
  const fp = path.join(WORKSPACE, 'rca-report.md');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'report not ready' });
  const md = fs.readFileSync(fp, 'utf8').replace(/<!--.*?-->/gs, '');
  res.setHeader('Content-Type', 'application/json');
  res.json({ html: marked(md) });
});

// ── Health probe ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', clients: clients.length }));

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`[dashboard] Server listening on port ${PORT}`);
  console.log(`[dashboard] Watching workspace: ${WORKSPACE}`);
  console.log(`[dashboard] Namespace: ${NAMESPACE}`);
  console.log(`[dashboard] Manifests dir: ${MANIFESTS}`);
});
