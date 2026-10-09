# Plan: Run Bob Shell as an OpenShift Job (Sydney Cluster → On-Prem Server)

## Top-Level Overview

Deploy the existing `container/Dockerfile`-based Bob Shell image to the **Sydney** OpenShift cluster as a one-shot **Job** for prompt testing. The Job authenticates to the **on-premise Bob server** (Tokyo TechZone cluster) using the inference API key from `.bob/inf-api-key.json`, routes all Bob traffic through `BOB_GATEWAY_URL`, and writes structured output to a workspace volume.

This is a standalone, minimal plan — no Fastify, no Redis, no long-running Deployment. The goal is to validate end-to-end connectivity: Sydney OCP → on-prem Bob API → watsonx inference.

---

## On-Premise Server Reference

| Purpose | URL |
|---|---|
| Bob API / Gateway (`BOB_GATEWAY_URL`) | `https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com` |
| Bob Web / Admin UI | `https://bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com` |
| Inference model (Ollama Qwen-Coder) | `https://ollama-coder-route-qwen-coder.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com` |
| Namespace on on-prem cluster | `ibm-bob` |
| Bob Version | `2.0.0` |

Inference API key source: `.bob/inf-api-key.json` → `apikey` field

---

## Sub-Tasks

---

### 1. Build and Push the Bob Shell Container Image

- **Intent**: Build the existing `container/Dockerfile` image and push it to the Sydney OpenShift internal image registry so the Job can pull it. The Dockerfile already installs Bob Shell 2.0.2 from the bundled tarball, pre-accepts the license, and sets `HOME=/bob-home` for arbitrary-UID compatibility.
- **Expected Outcomes**:
  - Image tagged and pushed to `image-registry.openshift-image-registry.svc:5000/<namespace>/bob-runner:latest` on the Sydney cluster.
  - `bob --version` confirmed in image build output.
- **Todo List**:
  - [ ] Log in to the Sydney OCP cluster with `oc login`.
  - [ ] Create the target namespace (e.g. `bob-test`) if it does not exist: `oc new-project bob-test`.
  - [ ] Expose the internal image registry externally: `oc patch configs.imageregistry.operator.openshift.io/cluster --patch '{"spec":{"defaultRoute":true}}' --type=merge` (if not already exposed).
  - [ ] Build the image from the workspace root: `docker build -f container/Dockerfile -t <registry>/bob-test/bob-runner:latest .`
  - [ ] Push the image: `docker push <registry>/bob-test/bob-runner:latest`
- **Relevant Context**:
  - [`container/Dockerfile`](container/Dockerfile) — existing image definition.
  - [`container/bobshell-2.0.2.tgz`](container/bobshell-2.0.2.tgz) — bundled Bob Shell package baked into the image.
  - [`container/entrypoint.sh`](container/entrypoint.sh) — entrypoint that calls `bob run`; already handles `BOB_GATEWAY_URL` and `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Status**: `[ ] pending`

---

### 2. Create the OpenShift Secret for the Inference API Key

- **Intent**: Store the inference API key from `.bob/inf-api-key.json` as an OpenShift `Secret` in the `bob-test` namespace. The Job will consume it via `envFrom` so the key never appears in plain text in a manifest committed to source control.
- **Expected Outcomes**:
  - A `Secret` named `bob-inf-credentials` exists in the `bob-test` namespace.
  - Contains `BOBSHELL_API_KEY` set to the `apikey` value from `.bob/inf-api-key.json`.
  - Contains `BOB_GATEWAY_URL` set to `https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com`.
- **Todo List**:
  - [ ] Create `k8s/job/01-secret.yaml` with `stringData.BOBSHELL_API_KEY` and `stringData.BOB_GATEWAY_URL`.
  - [ ] Apply: `oc apply -f k8s/job/01-secret.yaml -n bob-test`.
  - [ ] Verify: `oc get secret bob-inf-credentials -n bob-test`.
- **Relevant Context**:
  - API key value: from `.bob/inf-api-key.json` → `apikey` field (`bob_onprem_bob-apikey_4PWN...`).
  - `BOB_GATEWAY_URL` is read automatically by Bob 2.x — no CLI flag needed (confirmed in [`container/entrypoint.sh`](container/entrypoint.sh) line 48).
  - Existing pattern reference: [`k8s/01-secrets.yaml`](k8s/01-secrets.yaml).
- **Status**: `[ ] pending`

---

### 3. Write the OpenShift Job Manifest

- **Intent**: Define a Kubernetes `Job` manifest that runs the bob-runner image once, passes a test prompt via the `BOB_PROMPT` env var, injects credentials from the Secret, and writes output to an `emptyDir` volume.
- **Expected Outcomes**:
  - `k8s/job/02-bob-test-job.yaml` created and valid.
  - Job spec is OpenShift `restricted-v2` SCC compliant: non-root UID (`runAsNonRoot: true`), no privilege escalation, `readOnlyRootFilesystem` where possible, and `HOME=/bob-home` already set in the image.
  - `BOB_PROMPT` set to a simple test string: `"Hello from Sydney OpenShift. What model are you using?"`.
  - `CHAT_MODE` set to `agent`.
  - `OUTPUT_FILE` set to `/workspace/output.json`.
  - `NODE_TLS_REJECT_UNAUTHORIZED=0` to handle the on-prem self-signed certificate (already set in entrypoint; confirm as env var in Job spec for clarity).
- **Todo List**:
  - [ ] Create `k8s/job/02-bob-test-job.yaml` with `kind: Job`.
  - [ ] Set `spec.template.spec.restartPolicy: Never`.
  - [ ] Mount an `emptyDir` volume at `/workspace` for the output file.
  - [ ] Reference image from the internal registry: `image-registry.openshift-image-registry.svc:5000/bob-test/bob-runner:latest`.
  - [ ] Attach `envFrom.secretRef` pointing to `bob-inf-credentials`.
  - [ ] Add `BOB_PROMPT`, `CHAT_MODE`, `OUTPUT_FILE` as explicit `env` entries.
  - [ ] Set `securityContext.runAsNonRoot: true` and `allowPrivilegeEscalation: false`.
- **Relevant Context**:
  - [`container/entrypoint.sh`](container/entrypoint.sh) — reads `BOB_PROMPT`, `CHAT_MODE`, `OUTPUT_FILE`, `BOB_GATEWAY_URL`, `BOBSHELL_API_KEY`.
  - Existing Deployment pattern for reference: [`k8s/04-bob-runner.yaml`](k8s/04-bob-runner.yaml).
- **Status**: `[ ] pending`

---

### 4. Deploy and Test the Job on Sydney OpenShift

- **Intent**: Apply the Job manifest to the Sydney cluster, tail the pod logs to confirm Bob Shell reaches the on-prem server and receives an inference response, then verify the output JSON.
- **Expected Outcomes**:
  - Job pod reaches `Completed` status (not `Error`).
  - Pod logs show `[entrypoint] Using on-prem Bob gateway: https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com`.
  - Pod logs show `[DONE] status=success`.
  - `output.json` (or equivalent) is absent (success path) or contains a valid JSON response — the entrypoint only writes output.json on failure; success is confirmed by log lines.
- **Todo List**:
  - [ ] Apply the Job: `oc apply -f k8s/job/02-bob-test-job.yaml -n bob-test`.
  - [ ] Wait for pod to start: `oc get pods -n bob-test -l job-name=bob-test-job -w`.
  - [ ] Tail logs: `oc logs -f job/bob-test-job -n bob-test`.
  - [ ] On failure, retrieve the output JSON: `oc exec <pod> -- cat /workspace/output.json`.
  - [ ] Clean up after testing: `oc delete job bob-test-job -n bob-test`.
- **Relevant Context**:
  - On-prem Bob uses a self-signed TLS cert → `NODE_TLS_REJECT_UNAUTHORIZED=0` is critical.
  - If the pod shows `ImagePullBackOff`, verify the image was pushed to the correct registry path and `imagePullPolicy` is set appropriately.
  - If Bob exits non-zero, check logs for `Unable to verify certificate` → means TLS env var is not being picked up.
- **Status**: `[ ] pending`
