# Validation Plan: Bob Shell SRE Agent — Instana Query Job

## Top-Level Overview

**Goal:** Validate that the `instana-query-job` runs end-to-end on the Sydney OpenShift cluster — Bob Shell
connects to the on-prem server, the `instana` mode is loaded, the Instana API is reachable, and a valid
`instana-findings.json` is written to the shared PVC.

**Approach:** Three-phase validation — pre-flight checks in isolation, then a targeted single-agent job run,
then output inspection. We do not run the full 5-job pipeline — only the instana-query agent is exercised.

**Cluster:** Sydney OCP (`https://api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443`)
**Namespace:** `sre-demo`
**Target image:** `image-registry.openshift-image-registry.svc:5000/sre-demo/sre-bob:latest`
**Credentials Secret:** `sre-credentials` (already contains `BOBSHELL_API_KEY`, `BOB_GATEWAY_URL`,
`INSTANA_BASE_URL`, `INSTANA_API_TOKEN`)

**Non-Goals:**
- Running the full 5-job SRE pipeline
- Validating the aggregator, dashboard, or other agents
- Rebuilding the container image (image is assumed already built and pushed)

---

## Known Issues to Watch

| Issue | Where | Impact |
|---|---|---|
| `test-pod.yaml` uses wrong Secret (`bob-api-key`) and wrong `HOME=/root` | `manifests/test-pod.yaml` | Pod will fail to auth — do NOT use this manifest for validation |
| `run-demo.sh` line 35 references `manifests/aggregator-prompt-configmap.yaml` which doesn't exist | `manifests/run-demo.sh:35` | Full-run script will error at step 2 — irrelevant for this focused validation |
| Job manifest `BOB_PROMPT` uses inline `curl` not Python | `manifests/job-instana-query.yaml:45` | Functionally acceptable — curl is available in the image; validate it executes |

---

## Sub-Tasks

---

### Sub-Task 1 — Pre-flight: Verify Cluster Access and Prerequisites

**Status:** `[ ] pending`

**Intent:**
Confirm the operator is logged in to the correct cluster and all required resources (`sre-demo` namespace,
`sre-credentials` Secret, `sre-workspace` PVC, `mock-infra-data` ConfigMap, `sre-bob` image) already exist.
Catch missing prerequisites before any Job is submitted.

**Expected Outcomes:**
- Operator is authenticated as a cluster user on the Sydney OCP cluster
- `sre-demo` namespace exists
- `sre-credentials` Secret present with all 4 required keys: `BOBSHELL_API_KEY`, `BOB_GATEWAY_URL`,
  `INSTANA_BASE_URL`, `INSTANA_API_TOKEN`
- `sre-workspace` PVC is Bound (ReadWriteMany, 5Gi)
- `mock-infra-data` ConfigMap exists with `storage.json`, `network.json`, `server.json` keys
- `sre-bob:latest` image is available in the `sre-demo` ImageStream

**Todo List:**
1. `oc whoami` — confirm logged in; if not: `oc login --token=<token> --server=https://api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443`
2. `oc project sre-demo` — switch to namespace
3. `oc get secret sre-credentials -n sre-demo -o jsonpath='{.data}' | python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(k,'=',base64.b64decode(v).decode()[:30]+'...') for k,v in d.items()]"` — verify all 4 keys have non-empty values
4. `oc get pvc sre-workspace -n sre-demo` — confirm `STATUS=Bound`
5. `oc get configmap mock-infra-data -n sre-demo` — confirm it exists
6. `oc get imagestream sre-bob -n sre-demo` — confirm `latest` tag is populated; if missing, image needs to be built first (see Sub-Task 2 guard)

**Relevant Context:**
- Secret file: `manifests/secret.yaml` — contains all credentials in plaintext; this file is the source of truth for what values should be in the cluster Secret
- PVC spec: `manifests/pvc.yaml` — `ocs-storagecluster-cephfs` storage class, RWX
- BuildConfig: `manifests/buildconfig.yaml` — binary build from `container/Dockerfile` into `sre-bob:latest`

---

### Sub-Task 2 — (Conditional) Rebuild Image if Not Present

**Status:** `[ ] pending`

**Intent:**
If the `sre-bob:latest` ImageStream tag is missing or stale (older than the current `container/Dockerfile`),
rebuild it via the OpenShift binary BuildConfig. Only run this sub-task if Sub-Task 1 step 6 shows the
image is missing.

**Expected Outcomes:**
- `oc start-build sre-bob --from-dir=. --follow` completes with `Push successful`
- `oc get imagestream sre-bob -n sre-demo` shows a `latest` tag with a recent timestamp

**Todo List:**
1. `oc start-build sre-bob --from-dir=. --follow -n sre-demo` — triggers the binary build from workspace root
2. Wait for `Push successful` in build logs — build takes ~5 minutes (downloads oc binary and Bob Shell tarball)
3. `oc get imagestream sre-bob -n sre-demo` — confirm `latest` tag updated
4. If build fails: inspect with `oc logs -f bc/sre-bob -n sre-demo` and fix the specific error before continuing

**Relevant Context:**
- BuildConfig: `manifests/buildconfig.yaml` — `dockerfilePath: container/Dockerfile`
- The `container/Dockerfile` copies `container/bobshell-2.0.5.tgz` — this file MUST exist in the workspace at `oc start-build` time
- Dockerfile note at line 53: downloads `oc` from `mirror.openshift.com` at build time — requires outbound internet from the build pod

---

### Sub-Task 3 — Connectivity Test: Exec into a Debug Pod

**Status:** `[ ] pending`

**Intent:**
Before running the Job, manually exec into a temporary pod using the `sre-bob` image to verify:
1. Bob Shell starts and loads the `instana` mode
2. `BOB_GATEWAY_URL` routing works (on-prem Bob server reachable)
3. `INSTANA_BASE_URL` is reachable and the API token is valid

This catches auth and connectivity failures interactively rather than via Job log spelunking.

**Expected Outcomes:**
- `bob --version` shows `2.0.5`
- `bob run --mode instana --trust --max-turns 1 "Say hello and tell me your mode name."` completes with a response mentioning `instana`
- `curl -s -o /dev/null -w "%{http_code}" -H "authorization: apiToken $INSTANA_API_TOKEN" "$INSTANA_BASE_URL/api/events?windowSize=60000"` returns `200`

**Todo List:**
1. Launch debug pod with correct secret and HOME:
   ```bash
   oc run sre-bob-debug \
     --image=image-registry.openshift-image-registry.svc:5000/sre-demo/sre-bob:latest \
     --restart=Never \
     -n sre-demo \
     --overrides='{
       "spec": {
         "containers": [{
           "name": "sre-bob-debug",
           "image": "image-registry.openshift-image-registry.svc:5000/sre-demo/sre-bob:latest",
           "command": ["sleep", "3600"],
           "env": [
             {"name": "HOME", "value": "/bob-home"},
             {"name": "NODE_TLS_REJECT_UNAUTHORIZED", "value": "0"}
           ],
           "envFrom": [{"secretRef": {"name": "sre-credentials"}}]
         }]
       }
     }'
   ```
2. Wait for pod to be Running: `oc get pod sre-bob-debug -n sre-demo -w`
3. Exec in: `oc exec -it sre-bob-debug -n sre-demo -- /bin/bash`
4. Inside the pod, run:
   - `echo $BOB_GATEWAY_URL` — should print the on-prem URL
   - `echo $INSTANA_BASE_URL` — should print Instana URL
   - `bob --version` — should print `2.0.5`
   - `cat /bob-home/.bob/settings/custom_modes.yaml | grep slug` — should show `instana`, `openshift-sre`, `infra-sre`
   - `curl -sk -o /dev/null -w "%{http_code}" -H "authorization: apiToken $INSTANA_API_TOKEN" "$INSTANA_BASE_URL/api/events?windowSize=60000"` — should return `200`
   - `bob run --trust --mode instana --max-turns 1 "Say hello. State your mode name."` — verify Bob connects to on-prem and responds
5. Clean up: `oc delete pod sre-bob-debug -n sre-demo`

**Relevant Context:**
- `container/entrypoint.sh:42` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` — must also be set in the debug pod
- `container/Dockerfile:78` sets `ENV HOME=/bob-home` — must use `/bob-home` not `/root`
- `container/Dockerfile:83` bakes modes into `/bob-home/.bob/settings/custom_modes.yaml`
- Instana sandbox URL: `https://ibmdevsandbox-instanaibm.instana.io` (from `manifests/secret.yaml:15`)
- On-prem Bob gateway: `https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com`

---

### Sub-Task 4 — Run the Instana Query Job and Inspect Output

**Status:** `[ ] pending`

**Intent:**
Submit `manifests/job-instana-query.yaml` as the sole active job. Watch it run to completion, tail the logs,
and verify that `/workspace/instana-findings.json` was written with a valid schema and `"status": "success"`.

**Expected Outcomes:**
- Job pod transitions: `Pending` → `Init:0/1` (seed-mock-infra init container) → `Running` → `Completed`
- Pod logs show:
  - `[START] agent=instana-findings` (from entrypoint)
  - `[entrypoint] On-prem Bob gateway: https://api.bob.ibm-bob...`
  - No `Unable to verify certificate` errors
  - `[DONE] status=success`
- `/workspace/instana-findings.json` is valid JSON with:
  - `"status": "success"`
  - `"completed_at"` — a non-empty ISO8601 timestamp
  - `"incidents"` — an array (may be empty if no active incidents)
  - `"top_incident"` — object (may have empty fields if no incidents)
  - `"summary"` — a non-empty string

**Todo List:**
1. Delete any previous run: `oc delete job instana-query-job -n sre-demo --ignore-not-found`
2. Apply the PVC and ConfigMap first (idempotent):
   ```bash
   oc apply -f manifests/pvc.yaml
   oc apply -f manifests/mock-infra-configmap.yaml
   ```
3. Submit the job: `oc apply -f manifests/job-instana-query.yaml`
4. Watch pod status: `oc get pods -n sre-demo -l agent=instana-query -w`
5. Tail logs: `oc logs -f -l agent=instana-query -n sre-demo`
6. On completion, inspect the output file:
   ```bash
   oc run inspect-output \
     --image=busybox:1.36 --restart=Never -n sre-demo \
     --overrides='{"spec":{"containers":[{"name":"inspect","image":"busybox:1.36","command":["cat","/workspace/instana-findings.json"],"volumeMounts":[{"name":"ws","mountPath":"/workspace"}]}],"volumes":[{"name":"ws","persistentVolumeClaim":{"claimName":"sre-workspace"}}],"restartPolicy":"Never"}}'
   oc logs inspect-output -n sre-demo
   oc delete pod inspect-output -n sre-demo
   ```
7. Validate JSON structure — confirm all 5 required fields are present and `status == "success"`
8. If job fails (pod shows `Error` or `BackoffLimitExceeded`):
   - Check logs: `oc logs -l agent=instana-query -n sre-demo --previous`
   - Inspect failure sentinel: run the inspect-output pod above to read the failure JSON
   - Cross-reference with the failure modes in Sub-Task 5

**Relevant Context:**
- Job timeout: `activeDeadlineSeconds: 600` (10 minutes)
- `backoffLimit: 1` — one retry on pod failure before the Job is marked failed
- Init container `seed-mock-infra` copies mock data to `/workspace/mock-infra/` — instana mode doesn't use these files, but the init container must succeed for the main container to start
- The `BOB_PROMPT` in the Job uses inline `curl` (not Python) — this is valid since `curl` is installed in the image (`container/Dockerfile:38`)
- `$INSTANA_API_TOKEN` in the prompt string is an env var reference — it will be expanded by the shell inside the container since `CHAT_MODE=instana` is set and Bob's `execute` group is enabled

---

### Sub-Task 5 — Failure Mode Diagnosis Guide

**Status:** `[ ] pending`

**Intent:**
Document the specific diagnostic steps for each failure mode that is likely to occur, so the operator can
diagnose and fix without starting from scratch.

**Expected Outcomes:**
- Each failure scenario has a specific observable symptom and a targeted fix action
- No guess-work required during live troubleshooting

**Failure Modes and Fixes:**

| Symptom | Root Cause | Fix |
|---|---|---|
| Pod stuck in `Init:0/1` indefinitely | `busybox:1.36` image pull failure or PVC not Bound | Check `oc describe pod <pod> -n sre-demo` → Events; confirm PVC is Bound; confirm image registry connectivity |
| Pod `Error` immediately after init | Bob Shell fails to start — missing `HOME`, bad `BOBSHELL_API_KEY` | `oc logs <pod> -n sre-demo` — look for `Error: apiKey`; verify Secret has `BOBSHELL_API_KEY` set |
| Bob starts but returns `Session no longer active` | `BOB_GATEWAY_URL` not reachable from the Sydney cluster | `oc exec` into debug pod and `curl -sk $BOB_GATEWAY_URL/health` — if fails, network path to Tokyo on-prem is down |
| `Unable to verify certificate` in logs | `NODE_TLS_REJECT_UNAUTHORIZED` not set | Verify `container/entrypoint.sh` is the actual entrypoint (image built from `container/Dockerfile`, not `services/bob-runner/Dockerfile`) |
| Bob runs but writes `"status": "failed"` with `exit_code: 1` | Instana API call failed or curl returned non-200 | Check `instana-query.log` on PVC; check Instana API token validity with direct curl in debug pod |
| Mode `instana` not found | `custom_modes.yaml` not present in image | Exec into pod: `cat /bob-home/.bob/settings/custom_modes.yaml` — if missing, image was built from wrong Dockerfile or Python yaml build step failed |
| Output file not written at all | Bob ran but didn't write the file — model didn't follow instructions | Check logs for model output; consider simplifying the `BOB_PROMPT` or adding an explicit file-write instruction |
| `BackoffLimitExceeded` with `CrashLoopBackOff` | Pod crashes before Bob can run | Check `oc describe pod -n sre-demo` for OOMKilled or permission errors; verify `memory: 2Gi` limit is not hit |

**Todo List:**
1. This sub-task is a reference — no action required unless Sub-Task 4 encounters a failure
2. If a failure occurs in Sub-Task 4, navigate to the matching row above and follow the fix action
3. After fixing, re-run Sub-Task 4 from step 1

**Relevant Context:**
- Log tailing: `oc logs -f -l agent=instana-query -n sre-demo` (during run) or `oc logs -l agent=instana-query -n sre-demo --previous` (after failure)
- The entrypoint at `container/entrypoint.sh:84` always writes a failure sentinel JSON on non-zero Bob exit — so even a failed run produces an inspectable output file

---

## Validation Success Criteria

The instana-query agent is considered **validated** when ALL of the following are true:

1. ✅ Job pod reaches `Completed` status (not `Error` or `BackoffLimitExceeded`)
2. ✅ Pod logs contain `[DONE] status=success`
3. ✅ `/workspace/instana-findings.json` exists on the PVC
4. ✅ JSON is valid and contains: `status`, `completed_at`, `incidents`, `top_incident`, `summary`
5. ✅ `status == "success"` in the output JSON
6. ✅ `completed_at` is a non-empty ISO8601 timestamp
7. ✅ `summary` contains a human-readable description of what was found (or "no active incidents" if Instana has none)
