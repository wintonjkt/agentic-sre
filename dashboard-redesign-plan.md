# Dashboard Redesign Plan — Agentic SRE Live Investigation UI

## Top-Level Overview

Redesign the SRE dashboard into a 2-page SPA:
- **Page 1 (Launcher)**: Hero landing page with incident summary and a "Start Investigation" button that triggers the full pipeline.
- **Page 2 (Live Investigation)**: Real-time animated visualization of all 5 Bob CLI pods running in parallel — verbose log streams per agent, animated SVG DAG, Gantt timeline, and a final conclusion panel with the RCA report + Ansible playbook.

The backend (`server.js`) gains a `POST /api/trigger` endpoint (spawns `oc` job cleanup + launch), per-agent log file watching (chokidar tails `*.log` files each Bob pod writes alongside its findings), and a new `pod_log` SSE event type.

The Bob container `entrypoint.sh` is updated to tee Bob's stdout into a per-agent `.log` file in `/workspace`.

No new npm dependencies. No dashboard image rebuild for `oc`. Carbon Design System CDN only.

### Design Decisions (confirmed)
- **Previous results stay visible** on Page 2 until the new run produces new ones (no pre-clear of RCA/Ansible panel)
- **Full raw LLM reasoning** shown in agent log terminals (all Bob stdout: tool calls, thoughts, JSON)
- **Gantt timeline** in a collapsible section below the agent cards on Page 2

---

## Sub-Tasks

---

### Sub-Task 1 — Update `entrypoint.sh` to write verbose log files

**Intent**
Each Bob job pod must write its complete stdout (Bob's reasoning, tool calls, final JSON) into a `.log` file on the shared PVC. The dashboard tails these files via chokidar. No `oc` binary needed in the dashboard pod.

**Expected Outcomes**
- `instana-query-job` writes `/workspace/instana-query.log`
- `instana-rca-job` writes `/workspace/instana-rca.log`
- `openshift-check-job` writes `/workspace/openshift-check.log`
- `infra-check-job` writes `/workspace/infra-check.log`
- `rca-aggregator-job` writes `/workspace/rca-aggregator.log`
- Each log file has lines: `[timestamp] [entrypoint] ...` and Bob's raw stdout
- Log file is created at container start (even before Bob finishes)
- Findings JSON is written by Bob; log capture is transparent

**Todo List**
1. In `container/entrypoint.sh`, derive `LOG_FILE` from `OUTPUT_FILE` (replace extension with `.log`, using the same basename: `instana-findings.json` → `instana-query.log`). Use a new env var `LOG_FILE` that each Job manifest sets explicitly (simpler than deriving).
2. Add `LOG_FILE="${LOG_FILE:-/workspace/agent.log}"` near top of entrypoint.
3. `tee` all entrypoint echo lines and Bob's stdout to `$LOG_FILE` using `exec > >(tee -a "$LOG_FILE") 2>&1` at the top of the script.
4. Write a `[START]` marker line at the beginning and `[DONE status=...]` marker at the end so the dashboard can detect job completion from the log alone (fallback).
5. Update all 5 Job manifests to add `LOG_FILE` env var pointing to the correct `/workspace/<agent-id>.log` path.
6. Rebuild `sre-bob` image (build 8) since `entrypoint.sh` is baked into the image.

**Relevant Context**
- `container/entrypoint.sh` — current entrypoint
- `manifests/job-instana-query.yaml`, `job-instana-rca.yaml`, `job-openshift-check.yaml`, `job-infra-check.yaml`, `job-aggregator.yaml` — all need `LOG_FILE` env var added
- `container/Dockerfile` — `COPY container/entrypoint.sh /entrypoint.sh`
- Build: `oc start-build sre-bob --from-dir=. --follow -n sre-demo`

**Status** `[x] done`

---

### Sub-Task 2 — Add backend endpoints to `server.js`

**Intent**
Add three new capabilities to the Express server:
1. `POST /api/trigger` — cleanly deletes old jobs/workspace and re-applies all Job manifests via `oc` CLI (the dashboard pod's SA has sufficient RBAC already via `sre-agent` ClusterRoleBinding — but needs `create`/`delete` on Jobs too; check and patch RBAC).
2. Per-agent log file watching — chokidar watches `*.log` files and broadcasts `pod_log` SSE events line-by-line as new content is appended.
3. `GET /api/pipeline-status` — returns a JSON snapshot of which findings files exist and their parsed status.

**Expected Outcomes**
- `POST /api/trigger` responds `202 Accepted` immediately, then broadcasts `pipeline_event` SSE messages as jobs are deleted and re-created
- New SSE event shape: `{ type: "pod_log", agentId, line, ts }` emitted for each new line appended to a `.log` file
- New SSE event shape: `{ type: "pipeline_event", phase: "trigger"|"reset"|"launching"|"running", message, ts }`
- `GET /api/pipeline-status` returns `{ agents: { [agentId]: { status, hasLog, hasFindings } } }`
- Existing `agent_update` SSE and all current endpoints unchanged

**Todo List**
1. Add `const { exec } = require('child_process')` and `const fs = require('fs')` (already imported) to `server.js`.
2. Define `LOG_FILES` map: `{ 'instana-query': 'instana-query.log', ... }` alongside `AGENT_FILES`.
3. Add log file watchers in chokidar — watch `*.log` files. On `change`, read only the newly appended bytes (track file size per agent), split on `\n`, and broadcast each non-empty line as `{ type: 'pod_log', agentId, line, ts }`.
4. Add `POST /api/trigger` route:
   - Respond `202` immediately
   - Broadcast `pipeline_event { phase: 'reset' }` 
   - Exec: `oc delete jobs -l app=agentic-sre -n sre-demo --ignore-not-found`
   - Exec: workspace clear pod (same busybox pattern as `run-demo.sh`)
   - Exec: `oc apply -f manifests/job-instana-query.yaml -f manifests/job-instana-rca.yaml -f manifests/job-openshift-check.yaml -f manifests/job-infra-check.yaml -n sre-demo`
   - Wait 5s, exec: `oc apply -f manifests/job-aggregator.yaml -n sre-demo`
   - Broadcast `pipeline_event { phase: 'running' }` after each step
5. Add `GET /api/pipeline-status` route.
6. Add RBAC: update `manifests/rbac.yaml` to give `sre-agent` SA `create`/`delete`/`list`/`get` on `jobs` and `pods` resources in `sre-demo` namespace. Re-apply RBAC.
7. Mount the manifests directory into the dashboard pod (ConfigMap or emptyDir + init-container copy) so `oc apply -f manifests/...` paths resolve. **Simplest approach**: hardcode the Job YAML inline as strings in `server.js` (duplicate from YAML files) — avoids any volume mount change.

**Note on approach for step 7**: Embed the job YAML as inline `kubectl apply` heredoc strings in `server.js`, or mount the manifests PVC. The cleanest approach: the dashboard pod already has the PVC mounted at `/workspace`; store the 5 job YAML manifests as individual files there. The trigger endpoint copies them via an init step. OR: use `oc apply` with inline JSON using the Kubernetes API. **Decision**: Write the job YAML files into `/workspace/manifests/` from the dashboard pod's init container at startup (copy from a ConfigMap). This requires a new ConfigMap for each job YAML — complex. **Final decision**: Use `oc create job` CLI commands directly (reconstructing the job spec inline in the shell command string). This is simplest — no file mounts needed.

**Relevant Context**
- `dashboard/server.js` — file to modify
- `manifests/rbac.yaml` — needs Job RBAC added
- `manifests/dashboard-deployment.yaml` — may need manifest files mounted
- All job YAML files in `manifests/` — source of truth for job specs

**Status** `[ ] pending`

---

### Sub-Task 3 — Redesign `index.html` — Page 1: Investigation Launcher

**Intent**
Replace the current single-page dashboard with a 2-page SPA. Page 1 is the investigation launcher: a full-screen hero with IBM Carbon dark styling, a "Start Investigation" button, and a pre-flight status panel.

**Expected Outcomes**
- Page 1 visible on first load (if no pipeline is running)
- Hero section: IBM Agentic SRE logo, subtitle "Robot Shop · OpenShift Incident Response"
- Incident context card: static description of the Robot Shop incident scenario (6 affected services, critical symptoms)
- Pipeline status indicator: shows "No active investigation" or "Pipeline running" based on `/api/pipeline-status`
- **"▶ Start Investigation"** button: calls `POST /api/trigger`, immediately transitions to Page 2
- If a pipeline is already running or complete (findings files exist), show "▶ Re-run Investigation" instead with a warning
- Carbon Design: dark `g100` theme, `#0f62fe` interactive blue, IBM Plex Mono font, same `:root` vars as current page

**Todo List**
1. Add a JS `showPage(n)` function that toggles visibility of `#page-launcher` and `#page-investigation` divs.
2. Build `#page-launcher` HTML: header (reuse existing), hero grid with left info panel + right status panel, trigger button.
3. Add `fetchPipelineStatus()` on load — if any findings exist, show "Re-run" warning.
4. Wire trigger button: `POST /api/trigger` → on success call `showPage(2)` and `connectSSE()`.
5. Auto-detect running pipeline on SSE connect: if first `agent_update` arrives, auto-switch to Page 2.
6. Style: full-screen hero, Carbon tile backgrounds, animated gradient border on the trigger button while hovering.

**Relevant Context**
- `dashboard/public/index.html` — complete rewrite of body content (keep `<head>` CSS vars and Carbon CDN links)
- Current header HTML — reuse verbatim
- Current `connectSSE()`, `renderCards()`, `updateProgress()` JS — keep, move to Page 2 scope

**Status** `[ ] pending`

---

### Sub-Task 4 — Redesign `index.html` — Page 2: Live Investigation View

**Intent**
The investigation page shows the full real-time pipeline: animated SVG DAG of the 5 agents, verbose log stream per agent card, Gantt timeline bars, and the final RCA conclusion panel.

**Expected Outcomes**

**Agent Cards (enhanced)**
- Each card shows: icon, name, status badge, summary text (as before)
- Below the summary: a collapsible `<pre class="agent-log">` that auto-scrolls showing every `pod_log` line received for that agent, styled as a dark terminal (IBM Plex Mono, green text on near-black)
- Log panel starts collapsed; expands automatically when agent transitions to `running`
- Max height 200px with overflow-y scroll

**Animated SVG Pipeline DAG**
- SVG element showing 4 parallel agent nodes (row 1) feeding into 1 aggregator node (row 2)
- Nodes are rounded rectangles with the agent icon and name inside
- Animated dashed lines connecting each parallel agent to the aggregator
- Node border pulses blue while status=running, turns solid green on success, red on failed
- The connecting lines animate a moving dash while both endpoints are running/pending

**Gantt Timeline**
- Horizontal bar chart below the agent grid
- Each agent gets one row: label on left, bar shows elapsed time (grows right in real-time while running, stops on complete)
- Color-coded: blue=running, green=success, red=failed
- X-axis = seconds since pipeline start

**Final Conclusion Panel**
- Replaces the existing bottom-grid when aggregator completes
- Left panel: rendered RCA report markdown (same as current `#rca-content`)
- Right panel: Ansible YAML with syntax highlight + "Copy Playbook" clipboard button
- Animated fade-in when aggregator finishes

**Todo List**
1. Keep the existing `AGENTS` array, `agentState`, `renderCards()`, `updateProgress()`, `loadRcaReport()`, `loadPlaybook()` JS — they already work. Extend them.
2. Add `agentLogs = {}` map (agentId → string[]). Listen for `pod_log` SSE events and push lines.
3. Add log panel `<pre class="agent-log" id="log-{agentId}">` to each agent card (collapsed by default, 0px max-height; expand to 200px when running).
4. On each `pod_log` event: append line to DOM, auto-scroll to bottom, limit to last 200 lines.
5. Build SVG DAG: 4 boxes in a row (instana-query, instana-rca, openshift-check, infra-check), arrows pointing down to aggregator box. Use `<animate>` on `stroke-dashoffset` for the flowing-line effect while running.
6. Update `updateCard()` to also update the SVG node's CSS class (pulse/green/red).
7. Build Gantt: a `<div class="gantt-row">` per agent with an inner bar that grows via JS `setInterval` while status=running.
8. Wire Gantt start times from first `pod_log` event per agent (or from `agent_update` with status=running).
9. Ensure "Back to Launcher" button on Page 2 navigates back to Page 1.
10. "Copy Playbook" button uses `navigator.clipboard.writeText()`.

**Relevant Context**
- `dashboard/public/index.html` — all changes are in this file
- Existing `connectSSE()` in the current file handles `agent_update` events — extend to also handle `pod_log` and `pipeline_event`
- Carbon CDN already loaded; no new JS libraries needed (SVG animations are pure CSS/SVG)
- SSE new event types from Sub-Task 2: `pod_log { agentId, line, ts }`, `pipeline_event { phase, message, ts }`

**Status** `[ ] pending`

---

### Sub-Task 5 — Rebuild dashboard image and deploy

**Intent**
Push the updated `server.js` and `index.html` into a new dashboard image build and roll out the deployment.

**Expected Outcomes**
- `sre-dashboard-3` build completes successfully
- `sre-dashboard` deployment rolls out new pod
- Dashboard URL serves the new 2-page UI
- `POST /api/trigger` launches jobs and SSE streams log lines to browser

**Todo List**
1. Run: `oc start-build sre-dashboard --from-dir=. --follow -n sre-demo`
2. Verify rollout: `oc rollout status deployment/sre-dashboard -n sre-demo`
3. Smoke test: `curl -sk https://sre-dashboard-sre-demo.apps.../health`
4. Apply updated RBAC: `oc apply -f manifests/rbac.yaml -n sre-demo`
5. Trigger a test run via the browser UI — confirm all 5 agent cards animate, logs stream, DAG pulses, and final RCA panel populates.

**Relevant Context**
- `dashboard/Dockerfile` — unchanged (copies `dashboard/` directory)
- `manifests/rbac.yaml` — updated in Sub-Task 2
- OCP route: `sre-dashboard-sre-demo.apps.itz-mlbbmo.infra01-lb.tok04.techzone.ibm.com`

**Status** `[ ] pending`

---

## Implementation Order

```
Sub-Task 1 (entrypoint log files + sre-bob build 8)
  ↓
Sub-Task 2 (server.js backend: /api/trigger, log watching, RBAC)
  ↓
Sub-Task 3 (Page 1 launcher HTML)
  ↓
Sub-Task 4 (Page 2 live investigation HTML — enhanced cards + DAG + Gantt)
  ↓
Sub-Task 5 (dashboard image rebuild + deploy + smoke test)
```

Sub-Tasks 3 and 4 can be done in a single `index.html` edit pass since they are in the same file.
