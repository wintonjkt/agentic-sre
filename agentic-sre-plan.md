# Agentic SRE Demo — Bank App on OpenShift

## Top-Level Overview

**Goal:** Build a convincing, repeatable SRE demo for a bank running its application on OpenShift.
The demo automates the painful RCA workflow that today requires every team (app, DB, platform, hardware) to be
in a bridge call insisting they are "green".

**Target Application:** [Stan's Robot Shop](https://github.com/instana/robot-shop) — the Instana reference
polyglot microservices app (Node.js, Python, Java, Go, PHP, Nginx, MongoDB, MySQL, Redis, RabbitMQ).
Cloned to `robot-shop/`. Monitored by Instana. Bob agents use the source code and Helm templates as
grounded evidence when generating RCA reports and Ansible fixes. See `docs/robot-shop-context.md`.

**Approach:**
- Four independent OpenShift Jobs run in parallel — one per check domain. Each Job runs a single Bob CLI pod
  using `bob run --mode <mode> --trust` with `BOBSHELL_API_KEY` from a Kubernetes Secret. Each Job has a
  timeout and failure detection built in (TTL, activeDeadlineSeconds, backoffLimit).
- All pods write structured JSON findings to a shared PersistentVolumeClaim (`sre-workspace`, RWX).
- A fifth aggregator Job polls for all four findings files (with a deadline), then uses the Instana Bob mode to
  synthesise a unified RCA Markdown report and a dynamic Ansible playbook targeting the specific Robot Shop
  service identified as the root cause.
- A Node.js web server (sixth pod, always running) serves a live visualization dashboard that watches the shared
  PVC for file changes and pushes real-time updates to the browser over Server-Sent Events (SSE).

**Scope:**
- Three Bob modes: updated `instana` (Robot Shop topology baked in ✅), new `openshift-sre`, new `infra-sre`
- Container image `sre-bob:latest`: `node:22-slim` + Bob Shell 2.0.2 + `oc` 4.22 + `ansible` + `python3` ✅ built
- OpenShift: `sre-demo` namespace ✅, `bob-api-key` Secret ✅, `sre-bob` ImageStream ✅
- OpenShift manifests: PVC, Secret, ConfigMap (mock infra data), 4 worker Jobs, 1 aggregator Job, 1 dashboard Deployment/Service
- A Node.js + HTML dashboard served from a lightweight pod, using Server-Sent Events for live updates
- Slack webhook notification after the aggregator completes (optional, toggled by env var)

**Non-Goals:**
- Production-hardened RBAC, multi-tenant, or HA deployment
- Real hardware/storage/network telemetry (infra checks are mocked with realistic Robot Shop failure scenarios)
- Deploying Robot Shop — it is used as source code reference only

---

## Architecture

```
OpenShift Cluster
│
├── [always running] dashboard-pod  (Node.js SSE server)  ← browser connects here
│      watches /workspace/** for file changes → pushes events to browser
│
├── [Job 1] instana-query-job      bob --chat-mode=instana     → /workspace/instana-findings.json
├── [Job 2] instana-rca-job        bob --chat-mode=instana     → /workspace/instana-rca.json
├── [Job 3] openshift-check-job    bob --chat-mode=openshift-sre → /workspace/ocp-findings.json
├── [Job 4] infra-check-job        bob --chat-mode=infra-sre   → /workspace/infra-findings.json
│
└── [Job 5] rca-aggregator-job     bob --chat-mode=instana     → /workspace/rca-report.md
  (waits for all 4 findings files, timeout 10min)             → /workspace/remediation.yml
                                                               → POST Slack webhook (optional)
```

All pods mount PVC `sre-workspace` at `/workspace`.

---

## Sub-Tasks

---

### Sub-Task 1 — Extend the Instana Bob Mode

**Status:** `[ ] pending`

**Intent:**
The existing `.bob/modes/instana.yaml` mode has good identity text but needs explicit headless operation
guidance and JSON output schema so both Pod 1 (incident query) and Pod 2 (deep RCA) produce predictable
machine-readable output files that the aggregator and dashboard can consume.

**Expected Outcomes:**
- `.bob/modes/instana.yaml` updated with a "Headless Operation" section in `roleDefinition`
- Mode documents the two output file conventions: `instana-findings.json` and `instana-rca.json`
- Mode documents environment variables `INSTANA_BASE_URL` and `INSTANA_API_TOKEN`
- `groups` confirmed as `[read, edit, command, mcp]`

**Todo List:**
1. Read the current `.bob/modes/instana.yaml` in full
2. Add a "Headless Operation" section: always write findings to the file path given in the prompt, emit valid JSON, never ask interactive questions, write a `status` field (`success` or `failed`) and a `completed_at` ISO timestamp to every output file
3. Add output schema for `instana-findings.json`: `{ "status": "", "completed_at": "", "incidents": [], "top_incident": {}, "summary": "" }`
4. Add output schema for `instana-rca.json`: `{ "status": "", "completed_at": "", "incident_id": "", "timeline": [], "traces": [], "metrics": {}, "correlated_events": [], "root_cause_hypothesis": "", "summary": "" }`
5. Add environment variable conventions: `INSTANA_BASE_URL`, `INSTANA_API_TOKEN`
6. Ensure `groups` includes `read`, `edit`, `command`, `mcp`

**Relevant Context:**
- File: `.bob/modes/instana.yaml`
- Instana API auth: `Authorization: apiToken <token>`
- Key endpoints: `GET /api/events`, `POST /api/application-monitoring/analyze/traces`,
  `POST /api/infrastructure-monitoring/analyze/metrics`, `GET /api/automated-investigation/incidents/{eventId}`
- The `status` + `completed_at` fields in every output file are consumed by the dashboard SSE server

---

### Sub-Task 2 — Create the OpenShift SRE Bob Mode

**Status:** `[ ] pending`

**Intent:**
Create a new Bob mode `openshift-sre` specialising in OpenShift/Kubernetes health checks. Pod 3 uses this
mode to check for degraded pods, node pressure, failed operators, and warning events — all using read-only
`oc` CLI commands that are safe under `--yolo`.

**Expected Outcomes:**
- New file `.bob/modes/openshift-sre.yaml` created
- Mode writes findings to `/workspace/ocp-findings.json` with schema:
  `{ "status": "", "completed_at": "", "nodes": [], "pods": [], "operators": [], "events": [], "summary": "" }`
- Mode references `OCP_NAMESPACE` and `OCP_API_URL` env vars
- `groups: [read, edit, command]`

**Todo List:**
1. Create `.bob/modes/openshift-sre.yaml` with slug `openshift-sre`, name `🔴 OpenShift SRE`
2. Write `roleDefinition` covering: node health (`oc get nodes`, `oc describe nodes`), pod health
   (`oc get pods -n $OCP_NAMESPACE`, `oc get pods -A | grep -E 'CrashLoopBackOff|Error|Pending'`),
   cluster operators (`oc get clusteroperators`), resource pressure (`oc adm top nodes`, `oc adm top pods`),
   warning events (`oc get events --field-selector=type=Warning -n $OCP_NAMESPACE`)
3. Add "Headless Operation" section: same pattern as instana mode — write valid JSON to `/workspace/ocp-findings.json`, include `status` and `completed_at`, never ask interactive questions
4. Include output schema in `roleDefinition`
5. Add `whenToUse`, `description`, `groups: [read, edit, command]`

**Relevant Context:**
- Bob mode schema: follow `.bob/modes/instana.yaml` as the pattern
- `oc` must be installed in the container image (Sub-Task 5)
- `OCP_TOKEN` is used to authenticate: `oc login --token=$OCP_TOKEN --server=$OCP_API_URL`

---

### Sub-Task 3 — Create the Infrastructure SRE Bob Mode

**Status:** `[ ] pending`

**Intent:**
Create a new Bob mode `infra-sre` for Pod 4. Since real hardware/storage/network telemetry is out of demo
scope, this mode reads mocked JSON files from `/workspace/mock-infra/` and produces a structured findings
report — clearly labelled `"simulated": true`. The mock data is designed to plausibly correlate with what
Instana detects (e.g. storage volume at 95% causing DB slowness).

**Expected Outcomes:**
- New file `.bob/modes/infra-sre.yaml` created
- Mode reads `/workspace/mock-infra/storage.json`, `network.json`, `server.json`
- Mode writes findings to `/workspace/infra-findings.json` with schema:
  `{ "status": "", "completed_at": "", "storage": {}, "network": {}, "servers": [], "simulated": true, "anomalies": [], "summary": "" }`
- Mock data sample files created under `mock-data/` for reference (mounted via ConfigMap in Sub-Task 6)

**Todo List:**
1. Create `.bob/modes/infra-sre.yaml` with slug `infra-sre`, name `🖥️ Infrastructure SRE`
2. Write `roleDefinition` covering: read mock JSON files, interpret storage/network/server metrics,
   flag anomalies (thresholds: disk >90%, NIC errors >0, CPU >85%), always set `"simulated": true`
3. Add "Headless Operation" section: write valid JSON to `/workspace/infra-findings.json`, include
   `status` and `completed_at`, never ask interactive questions
4. Include mock data field schema in `roleDefinition` (storage: `used_pct`, `iops`, `latency_ms`;
   network: `nic_errors`, `bandwidth_util_pct`; server: `cpu_pct`, `mem_used_pct`)
5. Add `whenToUse`, `description`, `groups: [read, edit, command]`
6. Create `mock-data/storage.json`, `mock-data/network.json`, `mock-data/server.json` with realistic
   bank scenario values (storage at 95%, elevated latency, high CPU)

**Relevant Context:**
- Mock data should correlate with a plausible Instana incident: e.g. DB query latency spike caused by
  storage I/O saturation on the DB node
- The `"simulated": true` field is surfaced prominently in the dashboard visualization

---

### Sub-Task 4 — Create the RCA Aggregator Prompt

**Status:** `[ ] pending`

**Intent:**
Design the exact `--prompt` that Pod 5 passes to `bob --chat-mode=instana`. This prompt drives three
sequential steps: (1) read and cross-correlate all four findings files, (2) write a structured RCA
Markdown report, (3) generate a dynamic Ansible playbook targeting the top remediable issue.

**Expected Outcomes:**
- File `prompts/aggregator-prompt.txt` containing the complete multi-step instruction
- Output `/workspace/rca-report.md` with sections: Executive Summary, Incident Timeline, Root Cause
  Analysis, Affected Services, Business Impact, Remediation Steps, Ansible Automation Reference
- Output `/workspace/remediation.yml` — valid Ansible YAML, dynamically generated from findings, not a
  hardcoded template
- Both output files include a `<!-- completed_at: <ISO timestamp> -->` HTML comment at the top (for the
  dashboard to detect completion)

**Todo List:**
1. Create directory `prompts/`
2. Write `prompts/aggregator-prompt.txt` with explicit multi-step instructions
3. Step 1 in prompt: read all four findings files from `/workspace/`, cross-reference timestamps and anomalies
4. Step 2 in prompt: write `/workspace/rca-report.md` — full Markdown report with the defined sections;
   first line must be `<!-- completed_at: <ISO8601> -->`
5. Step 3 in prompt: write `/workspace/remediation.yml` — Ansible play with `hosts: all`,
   `gather_facts: false`, and a `tasks` list derived from the top finding; use `kubernetes.core.k8s`
   module for OCP fixes, `ansible.builtin.shell` for infra fixes
6. Step 4 in prompt (optional, conditional): if env var `SLACK_WEBHOOK_URL` is set, POST a summary
   message to it using `curl`

**Relevant Context:**
- Bob CLI invocation: `bob --chat-mode=instana --prompt="$(cat /prompts/aggregator-prompt.txt)" --yolo --hide-intermediary-output`
- The Instana mode has deep report-generation expertise — the aggregator prompt leverages it fully
- Ansible playbook is "dynamic": if the top issue is OCP pod crashloop, use `k8s` module to restart;
  if storage, use shell to clear logs; etc.

---

### Sub-Task 5 — Create the Bob SRE Container Image

**Status:** `[ ] pending`

**Intent:**
Build a single container image used by all five Bob CLI pods. It extends `bobshell-sandbox` and includes
all required tooling: `oc`, `curl`, `python3` + `requests`, and `ansible`. Bob modes are baked into the
image at the global modes directory so `--chat-mode=instana` etc. resolve correctly in headless runs.

**Expected Outcomes:**
- `container/Dockerfile` that builds cleanly
- Image includes: `oc` binary, `python3`, `pip install requests`, `ansible`, `curl`, `jq`
- `.bob/modes/*.yaml` copied to global Bob modes path inside the image
- `prompts/aggregator-prompt.txt` copied to `/prompts/`
- `container/build.sh` helper with image tag convention
- All required environment variables documented in a comment block

**Todo List:**
1. Create `container/Dockerfile` based on `FROM bobshell-sandbox`
2. Install `oc` from the OpenShift mirror (`https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/`)
3. Install system packages: `python3`, `python3-pip`, `curl`, `jq`, `ansible`
4. Run `pip3 install requests`
5. Copy `.bob/modes/` → `/root/.bob/modes/` (global modes directory for headless runs)
6. Copy `prompts/` → `/prompts/`
7. Create `container/build.sh` with `docker build -t sre-bob:latest -f container/Dockerfile .`
8. Add comment block documenting all required env vars:
   `INSTANA_BASE_URL`, `INSTANA_API_TOKEN`, `OCP_NAMESPACE`, `OCP_API_URL`, `OCP_TOKEN`,
   `SLACK_WEBHOOK_URL` (optional)

**Relevant Context:**
- `bobshell-sandbox` base image is the documented Bob container pattern
- Global modes path `/root/.bob/modes/` is the assumption — to be verified at build time
- The same image is used for all five Bob CLI pods; the `--chat-mode` and `--prompt` args differentiate them

---

### Sub-Task 6 — Build the Live Dashboard (Node.js + SSE)

**Status:** `[ ] pending`

**Intent:**
Build a lightweight Node.js web server that watches the shared PVC for file changes and streams live
updates to a browser dashboard over Server-Sent Events (SSE). The dashboard shows all five agent threads
as cards with real-time status (running, completed, failed), outputs the final RCA report as rendered
Markdown, and displays the generated Ansible playbook with syntax highlighting.

This is the "wow" component for the bank demo — executives and platform engineers can watch the agents
work in parallel in a browser, see each domain check complete, and watch the final report materialize.

**Expected Outcomes:**
- `dashboard/server.js` — Express.js server that:
  - Watches `/workspace/*.json`, `/workspace/rca-report.md`, `/workspace/remediation.yml` using `chokidar`
  - Emits SSE events on every file change: `{ type: "update", agent: "<name>", status: "", summary: "" }`
  - Serves `dashboard/public/index.html` as the UI
  - Exposes `GET /events` as the SSE endpoint
  - Exposes `GET /workspace/<filename>` to fetch file contents for the report/playbook panel
- `dashboard/public/index.html` — single-page dashboard with:
  - Five agent cards (instana-query, instana-rca, openshift-check, infra-check, rca-aggregator)
  - Each card shows: agent name, domain icon, status badge (🟡 Running / ✅ Done / ❌ Failed / ⏳ Waiting),
    elapsed time, and a one-line summary extracted from the findings JSON
  - Bottom panel: rendered RCA report (Markdown → HTML via `marked.js`)
  - Right panel: Ansible playbook with syntax highlight (via `highlight.js`)
  - Auto-scroll to new content as it arrives
  - No framework dependencies — vanilla JS + SSE EventSource API
- `dashboard/Dockerfile` — lightweight Node.js image for the dashboard pod
- `manifests/dashboard-deployment.yaml` + `manifests/dashboard-service.yaml` + `manifests/dashboard-route.yaml`
  (OpenShift Route to expose the dashboard via HTTPS)

**Todo List:**
1. Create `dashboard/` directory
2. Create `dashboard/package.json` with deps: `express`, `chokidar`, `marked` (server-side for initial render fallback)
3. Write `dashboard/server.js`:
   - Mount PVC at `/workspace` (container mount, same PVC)
   - Use `chokidar.watch('/workspace')` to detect file creation and changes
   - Parse each `*-findings.json` file on change: extract `status`, `completed_at`, `summary` fields
   - Emit SSE event to all connected clients on every change
   - Serve static files from `dashboard/public/`
   - Endpoint `GET /workspace/:file` — return raw file contents (for report and playbook panels)
   - Endpoint `GET /health` for liveness probe
4. Write `dashboard/public/index.html` with five agent cards, report panel, and playbook panel
5. Implement SSE EventSource client in the HTML's inline `<script>`:
   - Connect to `/events`
   - On each event: find the matching agent card and update its status badge, elapsed time, summary
   - When `rca-aggregator` status becomes `success`: fetch `/workspace/rca-report.md` and render it
   - When `rca-aggregator` status becomes `success`: fetch `/workspace/remediation.yml` and display with highlight
6. Create `dashboard/Dockerfile` based on `node:20-alpine`, COPY `package.json` + `server.js` + `public/`,
   RUN `npm ci --omit=dev`, EXPOSE `3000`, CMD `node server.js`
7. Create `manifests/dashboard-deployment.yaml` — single replica, mounts `sre-workspace` PVC at `/workspace`
8. Create `manifests/dashboard-service.yaml` — ClusterIP on port 3000
9. Create `manifests/dashboard-route.yaml` — OpenShift Route with TLS edge termination

**Relevant Context:**
- SSE (Server-Sent Events) is the correct choice over WebSockets: one-way server→client, no additional
  library on the client, works over HTTP/2 and through OpenShift Routes without special configuration
- `chokidar` is the standard Node.js file-watch library; it works with NFS-backed PVCs if `usePolling: true`
  is set (required for NFS mounts that do not propagate inotify events)
- The dashboard pod mounts the same `sre-workspace` PVC as all Bob pods
- The dashboard starts before the Jobs run — it shows "Waiting" state initially, then updates as agents write files

---

### Sub-Task 7 — Create the OpenShift Deployment Manifests

**Status:** `[ ] pending`

**Intent:**
Create all OpenShift/Kubernetes YAML manifests for the complete demo: PVC, Secret, mock-infra ConfigMap,
four worker Jobs with timeout and failure detection, one aggregator Job, and the demo orchestration script.
Each worker Job is independent (separate object) for maximum visibility in the OCP console.

**Expected Outcomes:**
- `manifests/pvc.yaml` — `sre-workspace` PVC, `ReadWriteMany`, 5Gi
- `manifests/secret.yaml` — credential Secret template with all required keys
- `manifests/mock-infra-configmap.yaml` — ConfigMap with three mock JSON data files
- Four separate Job manifests:
  - `manifests/job-instana-query.yaml`
  - `manifests/job-instana-rca.yaml`
  - `manifests/job-openshift-check.yaml`
  - `manifests/job-infra-check.yaml`
- `manifests/job-aggregator.yaml` — aggregator Job with:
  - Init container that polls for all four findings files (timeout: 10 minutes → writes `status: failed` sentinel and exits)
  - Main container runs the Bob aggregator prompt
  - `activeDeadlineSeconds: 900` (15 min hard deadline)
  - `backoffLimit: 0` (no retries — each run is a fresh demo)
- `manifests/run-demo.sh` — convenience script applying all manifests in correct order
- `manifests/cleanup.sh` — removes all Jobs and clears the PVC for re-runs

**Todo List:**
1. Create `manifests/pvc.yaml` — `ReadWriteMany`, 5Gi, StorageClass `nfs-client` (annotated for ODF too)
2. Create `manifests/secret.yaml` — keys: `INSTANA_BASE_URL`, `INSTANA_API_TOKEN`, `OCP_API_URL`, `OCP_TOKEN`,
   `SLACK_WEBHOOK_URL` (empty default); all values as base64-encoded placeholders
3. Create `manifests/mock-infra-configmap.yaml` — data keys: `storage.json`, `network.json`, `server.json`
   with the values from `mock-data/` files (Sub-Task 3)
4. Create each worker Job manifest with:
   - `spec.backoffLimit: 1` (one retry on pod failure)
   - `spec.activeDeadlineSeconds: 600` (10-minute timeout per worker)
   - `spec.ttlSecondsAfterFinished: 3600` (auto-clean after 1 hour)
   - Init container: copies mock-infra ConfigMap files to `/workspace/mock-infra/`
   - Main container: runs `bob --chat-mode=<mode> --prompt="<inline prompt>" --yolo --hide-intermediary-output`
   - On failure, the pod must write `{ "status": "failed", "error": "<exit reason>" }` to its output file
     (handled by a wrapper shell script as the container entrypoint)
5. Create `manifests/job-aggregator.yaml` with init container polling loop and hard deadline
6. Create `manifests/run-demo.sh`:
   ```
   oc apply -f manifests/pvc.yaml
   oc apply -f manifests/secret.yaml
   oc apply -f manifests/mock-infra-configmap.yaml
   oc apply -f manifests/dashboard-deployment.yaml
   oc apply -f manifests/dashboard-service.yaml
   oc apply -f manifests/dashboard-route.yaml
   # Launch 4 worker jobs in parallel
   oc apply -f manifests/job-instana-query.yaml \
            -f manifests/job-instana-rca.yaml \
            -f manifests/job-openshift-check.yaml \
            -f manifests/job-infra-check.yaml
   # Aggregator starts itself (polls for findings files internally)
   oc apply -f manifests/job-aggregator.yaml
   ```
7. Create `manifests/cleanup.sh` — delete all Jobs, optionally delete and recreate the PVC

**Relevant Context:**
- Four separate Job objects (not indexed completion) as confirmed — each appears as an independent object
  in the OCP console with its own logs, status, and events
- `activeDeadlineSeconds` is the correct Kubernetes field for Job-level timeout (kills all pods if exceeded)
- `ttlSecondsAfterFinished` auto-removes completed Jobs — set high enough for the demo viewing window
- The wrapper entrypoint shell script pattern: `bob ... ; echo $? > /tmp/exit; if [ $(cat /tmp/exit) -ne 0 ]; then write failure JSON; fi`
- OCP console shows each Job as a separate card — exactly what we want for the demo story

---

### Sub-Task 8 — Create the Demo README and Walkthrough

**Status:** `[ ] pending`

**Intent:**
Produce the top-level `README.md` and a `docs/sre-concept.md` that a sales engineer uses to run and
explain the demo. The README is the single entry point for setup, configuration, and execution.

**Expected Outcomes:**
- `README.md` with: Overview, Architecture, Prerequisites, Configuration, Running the Demo,
  Expected Outputs, Dashboard, Troubleshooting
- `docs/sre-concept.md` explaining the SRE problem, the agentic approach, and the "before vs after" story
- The demo story: **"Before: 4-hour bridge call. After: 10-minute automated RCA with Ansible remediation ready."**

**Todo List:**
1. Create `README.md` with all sections above, including the architecture ASCII diagram
2. Include credential setup instructions (edit `manifests/secret.yaml`, base64-encode values)
3. Include dashboard access instructions: `oc get route sre-dashboard -n <namespace>` → open in browser
4. Create `docs/sre-concept.md` with: the traditional RCA pain point, the agentic SRE approach,
   why Instana + Bob + OpenShift Jobs is the right stack, and the "before vs after" narrative
5. Link to all manifests, modes, and prompt files

**Relevant Context:**
- Audience: bank customer (CIO/CTO level) + IBM SE/SSA running the demo
- The dashboard URL is the main demo artifact — point the browser at it and let it run

---

## SRE Concept Validation

| Design Decision | Verdict | Reasoning |
|---|---|---|
| 4 separate Job objects (not indexed) | ✅ Correct | Each Job visible independently in OCP console — better demo story and better failure isolation |
| `activeDeadlineSeconds` + `backoffLimit` per Job | ✅ Correct | Standard K8s timeout mechanism; failure JSON written by wrapper script so dashboard shows `failed` not `unknown` |
| Instana as primary RCA backbone | ✅ Correct | Instana's `/api/automated-investigation/incidents/{eventId}` does cross-domain correlation automatically |
| Shared PVC as findings bus | ✅ Appropriate for demo | Auditable, simple, directly observable; production would use a message queue |
| SSE for live dashboard updates | ✅ Correct | Better than polling for a live demo; works over OpenShift Routes without extra config; one-way push is all that's needed |
| `chokidar` with `usePolling: true` | ✅ Required | NFS-backed RWX PVCs do not propagate inotify events to non-writing pods — polling is the correct fallback |
| Dynamic Ansible generation | ✅ Differentiator | Proves genuine AI reasoning rather than scripted output — critical for bank credibility |
| Bob `--yolo` flag for non-interactive approval | ✅ Correct | Confirmed headless execution pattern; safe because read-only commands dominate |

---

## Final File Structure

```
Agentic SRE/
├── .bob/
│   └── modes/
│       ├── instana.yaml             (updated — Sub-Task 1)
│       ├── openshift-sre.yaml       (new — Sub-Task 2)
│       └── infra-sre.yaml           (new — Sub-Task 3)
├── container/
│   ├── Dockerfile
│   └── build.sh
├── dashboard/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── public/
│       └── index.html
├── docs/
│   └── sre-concept.md
├── manifests/
│   ├── pvc.yaml
│   ├── secret.yaml
│   ├── mock-infra-configmap.yaml
│   ├── job-instana-query.yaml
│   ├── job-instana-rca.yaml
│   ├── job-openshift-check.yaml
│   ├── job-infra-check.yaml
│   ├── job-aggregator.yaml
│   ├── dashboard-deployment.yaml
│   ├── dashboard-service.yaml
│   ├── dashboard-route.yaml
│   ├── run-demo.sh
│   ├── cleanup.sh
│   └── README.md
├── mock-data/
│   ├── storage.json
│   ├── network.json
│   └── server.json
├── prompts/
│   └── aggregator-prompt.txt
└── README.md
```
