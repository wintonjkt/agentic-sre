#!/bin/bash
# =============================================================================
# Agentic SRE — Full Deploy Script
# Target cluster : https://api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443
# Bob server     : https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Prerequisites:
#   - oc CLI installed and on PATH
#   - docker / podman available (only for local builds; OCP binary build is used here)
# =============================================================================
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
OCP_SERVER="https://api.itz-nknwzi.infra01-lb.syd05.techzone.ibm.com:6443"
OCP_TOKEN="sha256~3gtM3WXfklDcxrElYBVvQKiSuzMWuco5yyfUUyRMtqw"
NAMESPACE="sre-demo"
IMAGE_BASE="image-registry.openshift-image-registry.svc:5000/${NAMESPACE}"

echo "============================================================"
echo " Agentic SRE — Deploying to new OCP cluster"
echo " Cluster : ${OCP_SERVER}"
echo " Namespace: ${NAMESPACE}"
echo "============================================================"
echo ""

# ── Step 1: OCP Login ─────────────────────────────────────────────────────────
echo "[1/9] Logging into OpenShift cluster..."
oc login \
  --token="${OCP_TOKEN}" \
  --server="${OCP_SERVER}" \
  --insecure-skip-tls-verify=true

oc whoami
echo ""

# ── Step 2: Create / switch namespace ─────────────────────────────────────────
echo "[2/9] Ensuring namespace '${NAMESPACE}' exists..."
oc get project "${NAMESPACE}" &>/dev/null \
  || oc new-project "${NAMESPACE}" --description="Agentic SRE Demo"
oc project "${NAMESPACE}"
echo ""

# ── Step 3: RBAC — ServiceAccount, Roles, ClusterRoleBindings ────────────────
echo "[3/9] Applying RBAC (ServiceAccount + ClusterRoleBinding)..."
oc apply -f manifests/rbac.yaml
echo ""

# ── Step 4: PVC (ReadWriteMany / CephFS) ──────────────────────────────────────
echo "[4/9] Applying PVC (ocs-storagecluster-cephfs, 5Gi RWX)..."
oc apply -f manifests/pvc.yaml
echo ""

# ── Step 5: Secrets & ConfigMaps ─────────────────────────────────────────────
echo "[5/9] Applying Secrets and ConfigMaps..."
oc apply -f manifests/secret.yaml
oc apply -f manifests/mock-infra-configmap.yaml

# Aggregator prompt configmap — create from file if it exists, otherwise warn
if [ -f manifests/aggregator-prompt-configmap.yaml ]; then
  oc apply -f manifests/aggregator-prompt-configmap.yaml
else
  echo "  [WARN] manifests/aggregator-prompt-configmap.yaml not found — creating from prompts/aggregator-prompt.txt"
  oc create configmap aggregator-prompt-cm \
    --from-file=prompt.txt=prompts/aggregator-prompt.txt \
    -n "${NAMESPACE}" \
    --dry-run=client -o yaml | oc apply -f -
fi
echo ""

# ── Step 6: Build sre-bob image ───────────────────────────────────────────────
echo "[6/9] Building sre-bob container image via OCP binary build..."

# Create/update the ImageStream + BuildConfig
oc apply -f manifests/buildconfig.yaml

# Wait for BuildConfig to be ready
sleep 2

# Trigger binary build — sends the entire workspace directory as build context
# The Dockerfile at container/Dockerfile is used (set in BuildConfig spec)
echo "  Starting binary build (this may take 3-5 minutes)..."
oc start-build sre-bob \
  --from-dir=. \
  --follow \
  --wait \
  -n "${NAMESPACE}"

echo "  ✅ sre-bob image built successfully"
echo ""

# ── Step 7: Build sre-dashboard image ─────────────────────────────────────────
if [ -f manifests/dashboard-buildconfig.yaml ]; then
  echo "[7/9] Building sre-dashboard container image..."
  oc apply -f manifests/dashboard-buildconfig.yaml
  sleep 2
  oc start-build sre-dashboard \
    --from-dir=. \
    --follow \
    --wait \
    -n "${NAMESPACE}"
  echo "  ✅ sre-dashboard image built successfully"
else
  echo "[7/9] Skipping dashboard build (manifests/dashboard-buildconfig.yaml not found)"
fi
echo ""

# ── Step 8: Deploy dashboard ──────────────────────────────────────────────────
echo "[8/9] Deploying SRE dashboard..."
oc apply -f manifests/dashboard-deployment.yaml

# Wait for dashboard rollout
oc rollout status deployment/sre-dashboard -n "${NAMESPACE}" --timeout=120s || true

DASHBOARD_HOST=$(oc get route sre-dashboard -n "${NAMESPACE}" \
  -o jsonpath='{.spec.host}' 2>/dev/null || echo "pending")
echo ""
echo "  📊 Dashboard URL : https://${DASHBOARD_HOST}"
echo ""

# ── Step 9: Verify readiness ──────────────────────────────────────────────────
echo "[9/9] Cluster resource summary:"
echo ""
oc get pvc,secret,configmap,deployment,route -n "${NAMESPACE}" \
  -l app=agentic-sre --no-headers 2>/dev/null || true
echo ""

echo "============================================================"
echo " ✅ Deployment complete!"
echo ""
echo " To run the SRE pipeline:"
echo "   ./manifests/run-demo.sh"
echo ""
echo " To watch job status after run:"
echo "   oc get jobs -n ${NAMESPACE} -l app=agentic-sre -w"
echo ""
echo " Bob server (on-prem):"
echo "   https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com"
echo "============================================================"
