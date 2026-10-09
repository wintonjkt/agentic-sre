#!/bin/bash
# =============================================================================
# Agentic SRE Demo — Full Run Script
# Usage: ./manifests/run-demo.sh
# =============================================================================
set -euo pipefail

NAMESPACE="sre-demo"
IMAGE_BASE="image-registry.openshift-image-registry.svc:5000/${NAMESPACE}"

echo "======================================================"
echo " Agentic SRE Demo — Robot Shop Incident Response"
echo "======================================================"
echo ""

# 1. Ensure logged in
oc whoami || { echo "ERROR: Not logged in. Run: oc login --token=<token> --server=<url>"; exit 1; }
oc project "${NAMESPACE}"

# 2. Clean up any previous run
echo "[1/8] Cleaning up previous jobs and workspace..."
oc delete job instana-query-job instana-rca-job openshift-check-job infra-check-job rca-aggregator-job \
  -n "${NAMESPACE}" --ignore-not-found
# Clear workspace by deleting a reset pod
oc run workspace-reset --image=busybox:1.36 --restart=Never -n "${NAMESPACE}" \
  --overrides='{"spec":{"containers":[{"name":"reset","image":"busybox:1.36","command":["sh","-c","rm -rf /workspace/* && echo cleared"],"volumeMounts":[{"name":"ws","mountPath":"/workspace"}]}],"volumes":[{"name":"ws","persistentVolumeClaim":{"claimName":"sre-workspace"}}],"restartPolicy":"Never"}}' \
  --wait --timeout=30s 2>/dev/null || true
oc delete pod workspace-reset -n "${NAMESPACE}" --ignore-not-found

# 3. Apply infrastructure
echo "[2/8] Applying PVC, Secrets, ConfigMaps..."
oc apply -f manifests/pvc.yaml
oc apply -f manifests/secret.yaml
oc apply -f manifests/mock-infra-configmap.yaml
oc apply -f manifests/aggregator-prompt-configmap.yaml

# 4. Deploy dashboard (if not already running)
echo "[3/8] Deploying dashboard..."
oc apply -f manifests/dashboard-deployment.yaml

# 5. Get dashboard URL
DASHBOARD_URL=$(oc get route sre-dashboard -n "${NAMESPACE}" -o jsonpath='{.spec.host}' 2>/dev/null || echo "pending")
echo ""
echo "  📊 Dashboard: https://${DASHBOARD_URL}"
echo ""

# 6. Launch 4 parallel worker jobs
echo "[4/8] Launching 4 parallel SRE agent jobs..."
oc apply -f manifests/job-instana-query.yaml
oc apply -f manifests/job-instana-rca.yaml
oc apply -f manifests/job-openshift-check.yaml
oc apply -f manifests/job-infra-check.yaml
echo "  ✅ Jobs launched in parallel"

# 7. Launch aggregator
echo "[5/8] Launching RCA aggregator job..."
oc apply -f manifests/job-aggregator.yaml
echo "  ✅ Aggregator started (polls for findings, 10-min timeout)"

# 8. Watch job status
echo ""
echo "[6/8] Watching job status (Ctrl+C to exit, pipeline continues)..."
echo ""
watch -n 5 "oc get jobs -n ${NAMESPACE} -l app=agentic-sre && echo '' && oc get pods -n ${NAMESPACE} -l app=agentic-sre"
