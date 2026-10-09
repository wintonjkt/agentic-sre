#!/bin/bash
# =============================================================================
# Agentic SRE Demo — Cleanup Script
# Usage: ./manifests/cleanup.sh [--all]
# --all: also delete PVC, Secret, and dashboard
# =============================================================================
set -euo pipefail
NAMESPACE="sre-demo"

echo "[cleanup] Deleting jobs..."
oc delete job instana-query-job instana-rca-job openshift-check-job infra-check-job rca-aggregator-job \
  -n "${NAMESPACE}" --ignore-not-found

if [[ "${1:-}" == "--all" ]]; then
  echo "[cleanup] Deleting all resources..."
  oc delete deployment sre-dashboard bob-chat-ui -n "${NAMESPACE}" --ignore-not-found
  oc delete service sre-dashboard bob-chat-ui -n "${NAMESPACE}" --ignore-not-found
  oc delete route sre-dashboard bob-chat-ui -n "${NAMESPACE}" --ignore-not-found
  oc delete buildconfig bob-chat-ui -n "${NAMESPACE}" --ignore-not-found
  oc delete imagestream bob-chat-ui -n "${NAMESPACE}" --ignore-not-found
  oc delete pvc sre-workspace -n "${NAMESPACE}" --ignore-not-found
  oc delete secret sre-credentials -n "${NAMESPACE}" --ignore-not-found
  oc delete configmap mock-infra-data aggregator-prompt-cm -n "${NAMESPACE}" --ignore-not-found
else
  echo "[cleanup] Clearing workspace files only..."
  oc run workspace-reset --image=busybox:1.36 --restart=Never -n "${NAMESPACE}" \
    --overrides='{"spec":{"containers":[{"name":"reset","image":"busybox:1.36","command":["sh","-c","rm -rf /workspace/* && echo cleared"],"volumeMounts":[{"name":"ws","mountPath":"/workspace"}]}],"volumes":[{"name":"ws","persistentVolumeClaim":{"claimName":"sre-workspace"}}],"restartPolicy":"Never"}}' \
    --wait --timeout=30s 2>/dev/null || true
  oc delete pod workspace-reset -n "${NAMESPACE}" --ignore-not-found
fi
echo "[cleanup] Done. Run ./manifests/run-demo.sh to start again."
