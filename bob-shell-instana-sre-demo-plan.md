# Plan: Deploy Bob Shell (Instana Mode) to Sydney Cluster — sre-demo Namespace

## Top-Level Overview

Deploy the existing `container/Dockerfile`-based Bob Shell 2.0.5 image to the **Sydney** OpenShift cluster, targeting the pre-existing **`sre-demo`** namespace. The Job runs in **`instana`** mode, authenticates to the on-premise Bob server (Tokyo TechZone) via the inference API key, and executes a connectivity validation prompt.

The existing `k8s/job/` manifests are reused with targeted namespace and mode overrides. No new architecture is introduced.

---

## On-Premise Bob Server Reference

| Purpose | URL |
|---|---|
| Bob API Gateway (`BOB_GATEWAY_URL`) | `https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com` |
| Inference model (Ollama Qwen-Coder) | `https://ollama-coder-route-qwen-coder.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com` |
| On-prem namespace | `ibm-bob` |
| Bob Version | `2.0.0` |

Inference API key source: `.bob/inf-api-key.json` → `apikey` field

---

## Sub-Tasks

---

### 1. Update Manifests for sre-demo Namespace and instana Mode

- **Intent**: Update `k8s/job/01-secret.yaml` and `k8s/job/02-bob-test-job.yaml` to target the `sre-demo` namespace, set `CHAT_MODE` to `instana`, and update the image registry path to `sre-demo`.
- **Expected Outcomes**:
  - Both manifests declare `namespace: sre-demo`.
  - `CHAT_MODE` is `instana` in the Job spec.
  - Image reference is `image-registry.openshift-image-registry.svc:5000/sre-demo/bob-runner:latest`.
  - `BOB_PROMPT` is `"Say hello in one sentence. Do not use any tools."` for connectivity validation.
- **Todo List**:
  - [ ] Edit `k8s/job/01-secret.yaml`: change `namespace: bob-test` → `namespace: sre-demo`.
  - [ ] Edit `k8s/job/02-bob-test-job.yaml`: change `namespace: bob-test` → `namespace: sre-demo`.
  - [ ] Edit `k8s/job/02-bob-test-job.yaml`: change `CHAT_MODE` value from `agent` → `instana`.
  - [ ] Edit `k8s/job/02-bob-test-job.yaml`: change image registry namespace from `bob-test` to `sre-demo`.
- **Relevant Context**:
  - [`k8s/job/01-secret.yaml`](k8s/job/01-secret.yaml) — Secret with `BOBSHELL_API_KEY` and `BOB_GATEWAY_URL`.
  - [`k8s/job/02-bob-test-job.yaml`](k8s/job/02-bob-test-job.yaml) — Job manifest.
  - `sre-demo` namespace already exists — no `oc new-project` needed.
- **Status**: `[ ] pending`

---

### 2. Build and Push the Bob Shell Container Image

- **Intent**: Build the Bob Shell 2.0.5 image from `container/Dockerfile` and push it to the Sydney OpenShift internal registry under the `sre-demo` namespace so the Job can pull it.
- **Expected Outcomes**:
  - Image pushed to `image-registry.openshift-image-registry.svc:5000/sre-demo/bob-runner:latest` (internal route).
  - `bob --version` confirms 2.0.5 in build output.
  - `instana`, `openshift-sre`, and `infra-sre` modes are baked into `/bob-home/.bob/settings/custom_modes.yaml`.
- **Todo List**:
  - [ ] Log in to the Sydney OCP cluster: `oc login`.
  - [ ] Expose the internal image registry external route (if not already): `oc patch configs.imageregistry.operator.openshift.io/cluster --patch '{"spec":{"defaultRoute":true}}' --type=merge`.
  - [ ] Get the external registry hostname: `oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}'`.
  - [ ] Log Docker in to the registry: `docker login -u $(oc whoami) -p $(oc whoami --show-token) <registry-host>`.
  - [ ] Build from workspace root: `docker build -f container/Dockerfile -t <registry-host>/sre-demo/bob-runner:latest .`
  - [ ] Push: `docker push <registry-host>/sre-demo/bob-runner:latest`
- **Relevant Context**:
  - [`container/Dockerfile`](container/Dockerfile) — copies `.bob/modes/` and bundles `bobshell-2.0.5.tgz`.
  - [`container/entrypoint.sh`](container/entrypoint.sh) — handles `BOB_GATEWAY_URL`, `BOBSHELL_API_KEY`, `CHAT_MODE`, `BOB_PROMPT`, `OUTPUT_FILE`.
  - Build context must be the workspace root (not `container/`) because the Dockerfile copies `.bob/modes/`.
- **Status**: `[ ] pending`

---

### 3. Apply the Secret and Job to the Sydney Cluster

- **Intent**: Apply the updated manifests to the `sre-demo` namespace on the Sydney cluster to create the credentials Secret and launch the Job.
- **Expected Outcomes**:
  - Secret `bob-inf-credentials` exists in `sre-demo`.
  - Job `bob-test-job` pod reaches `Completed` state.
  - Pod logs confirm on-prem Bob gateway is reached and `[DONE] status=success` is printed.
- **Todo List**:
  - [ ] Apply the Secret: `oc apply -f k8s/job/01-secret.yaml -n sre-demo`.
  - [ ] Verify Secret exists: `oc get secret bob-inf-credentials -n sre-demo`.
  - [ ] Apply the Job: `oc apply -f k8s/job/02-bob-test-job.yaml -n sre-demo`.
  - [ ] Watch pod status: `oc get pods -n sre-demo -l app=bob-shell-job -w`.
  - [ ] Tail logs: `oc logs -f job/bob-test-job -n sre-demo`.
  - [ ] On failure, inspect output JSON: `oc exec <pod> -n sre-demo -- cat /workspace/output.json`.
  - [ ] Clean up after validation: `oc delete job bob-test-job -n sre-demo`.
- **Relevant Context**:
  - Self-signed cert on on-prem Bob server → `NODE_TLS_REJECT_UNAUTHORIZED=0` is already set in both the entrypoint and the Job spec `env`.
  - `ImagePullBackOff` → image was not pushed to the correct registry path; re-check step 2.
  - Bob non-zero exit → check logs for TLS errors or gateway connectivity issues.
- **Status**: `[ ] pending`
