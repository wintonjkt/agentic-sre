# SRE Agent App — Sydney OpenShift Fast Build & Deployment Plan

## Top-Level Overview
Deploy the full Agentic SRE suite to the Sydney OpenShift cluster (`api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443`) using OpenShift in-cluster Binary Builds (`oc start-build --from-dir=.`). This approach provides the fastest path to deployment by eliminating local container daemon requirements and bypassing slow image uploads across WAN.

The deployment covers the full stack:
1. **Cluster Setup & Storage Foundation**: Namespace, RBAC, RWX storage (CephFS), secrets, and telemetry configmaps.
2. **SRE Agent Pipeline & Live Dashboard**: In-cluster build of `sre-bob` (Bob CLI 2.0.5 + SRE modes) and `sre-dashboard` (Node.js/Express + live SSE file watcher), followed by dashboard deployment.
3. **Interactive Chat Assistant Microservices**: Redis state store, Bob Runner execution engine, and Context Manager routing service with public Route.
4. **Verification & Pipeline Execution**: End-to-end smoke test verifying dashboard connectivity, agent job execution against Instana and OCP APIs, and synthesis of RCA reports.

---

## Sub-Tasks

### Sub-Task 1: OpenShift Authentication & Environment Preparation
- **Intent**: Authenticate to the Sydney cluster using active credentials from `.bob/OCP-Token`, create/ensure the `sre-demo` project, and update deployment script configurations.
- **Expected Outcomes**:
  - `oc` CLI authenticated to `https://api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443`.
  - Project `sre-demo` active and ready for resource provisioning.
  - Script token in `deploy.sh` updated with current token from `.bob/OCP-Token`.
- **Todo List**:
  1. Extract active token from `.bob/OCP-Token` and execute `oc login` to verify cluster connectivity.
  2. Ensure namespace `sre-demo` exists and set it as the active project.
  3. Synchronize `deploy.sh` and `manifests/secret.yaml` with the latest cluster API URL and credentials.
- **Relevant Context**:
  - `.bob/OCP-Token`
  - `deploy.sh`
  - `manifests/secret.yaml`
- **Status**: `[ ] pending`

---

### Sub-Task 2: Foundation Provisioning (RBAC, Storage, Secrets & ConfigMaps)
- **Intent**: Establish foundational Kubernetes objects required by both the batch SRE pipeline jobs and the interactive microservices.
- **Expected Outcomes**:
  - `sre-agent` ServiceAccount created with required cluster read and job management roles.
  - 5Gi ReadWriteMany PVC (`sre-workspace`) provisioned on `ocs-storagecluster-cephfs`.
  - Secrets (`sre-credentials`, `bob-credentials`) and ConfigMaps (`mock-infra-data`, `aggregator-prompt-cm`, `bob-chat-config`) applied in `sre-demo`.
- **Todo List**:
  1. Apply RBAC definitions from `manifests/rbac.yaml`.
  2. Apply PVC configuration from `manifests/pvc.yaml`.
  3. Apply secrets from `manifests/secret.yaml` and `k8s/01-secrets.yaml`.
  4. Apply telemetry mock ConfigMaps and aggregator prompt ConfigMaps.
- **Relevant Context**:
  - `manifests/rbac.yaml`
  - `manifests/pvc.yaml`
  - `manifests/secret.yaml`
  - `manifests/mock-infra-configmap.yaml`
  - `k8s/01-secrets.yaml`
  - `k8s/02-configmap.yaml`
- **Status**: `[ ] pending`

---

### Sub-Task 3: In-Cluster Binary Builds for Agent Pipeline & Dashboard
- **Intent**: Trigger OpenShift binary builds to build container images directly within the OpenShift cluster's internal registry.
- **Expected Outcomes**:
  - ImageStream `sre-bob:latest` built containing Bob Shell 2.0.5, SRE custom modes (`instana`, `openshift-sre`, `infra-sre`), and diagnostic CLIs.
  - ImageStream `sre-dashboard:latest` built containing the Express dashboard server and embedded manifests.
- **Todo List**:
  1. Apply ImageStream and BuildConfig manifests for `sre-bob` (`manifests/buildconfig.yaml`).
  2. Start and stream binary build: `oc start-build sre-bob --from-dir=. --follow`.
  3. Apply ImageStream and BuildConfig manifests for `sre-dashboard` (`manifests/dashboard-buildconfig.yaml`).
  4. Start and stream binary build: `oc start-build sre-dashboard --from-dir=. --follow`.
- **Relevant Context**:
  - `container/Dockerfile`
  - `dashboard/Dockerfile`
  - `manifests/buildconfig.yaml`
  - `manifests/dashboard-buildconfig.yaml`
  - `.dockerignore`
- **Status**: `[ ] pending`

---

### Sub-Task 4: Deploy SRE Dashboard & Interactive Chat Microservices
- **Intent**: Deploy and expose all user-facing and backend workloads (SRE Dashboard, Redis, Bob Runner, Context Manager).
- **Expected Outcomes**:
  - `sre-dashboard` deployment running with mounted `/workspace` PVC and edge-terminated Route.
  - `redis` deployment and service running for session caching.
  - `bob-runner` deployment and internal service running.
  - `context-manager` deployment and public Route created for interactive chat.
- **Todo List**:
  1. Apply `manifests/dashboard-deployment.yaml` and await rollout status.
  2. Deploy Redis state service from `k8s/03-redis.yaml`.
  3. Apply/align Bob Runner and Context Manager manifests (`k8s/04-bob-runner.yaml`, `k8s/05-context-manager-route.yaml`) to `sre-demo` namespace and deploy them.
  4. Verify all Deployments, Services, and Routes reach `Ready`/`Running` status.
- **Relevant Context**:
  - `manifests/dashboard-deployment.yaml`
  - `k8s/03-redis.yaml`
  - `k8s/04-bob-runner.yaml`
  - `k8s/05-context-manager-route.yaml`
- **Status**: `[ ] pending`

---

### Sub-Task 5: End-to-End Pipeline Smoke Test & Verification
- **Intent**: Validate the full SRE agent workflow by triggering parallel diagnostic jobs, monitoring live dashboard streaming, and generating synthesized RCA reports.
- **Expected Outcomes**:
  - SRE Dashboard URL accessible and receiving SSE file events.
  - 4 parallel agent jobs executed (`instana-query`, `instana-rca`, `openshift-check`, `infra-check`) with outputs written to `/workspace`.
  - Sequential aggregator job successfully produces `rca-report.md` and `remediation.yml`.
  - Interactive chat route responds to test prompt.
- **Todo List**:
  1. Retrieve and display public Routes for SRE Dashboard and Context Manager UI.
  2. Execute the demo pipeline script (`manifests/run-demo.sh`).
  3. Monitor Job execution and verify generated artifacts in `/workspace`.
  4. Validate dashboard log streaming and report rendering.
- **Relevant Context**:
  - `manifests/run-demo.sh`
  - `manifests/job-instana-query.yaml`
  - `manifests/job-instana-rca.yaml`
  - `manifests/job-openshift-check.yaml`
  - `manifests/job-infra-check.yaml`
  - `manifests/job-aggregator.yaml`
- **Status**: `[ ] pending`
