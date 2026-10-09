#!/bin/bash
# SRE Bob Shell 2.0.5 entrypoint
# Wraps `bob run` with failure detection — writes structured JSON on error
# so the dashboard and aggregator always receive a definitive status.
#
# Bob 2.x headless execution model:
#   bob run --trust --mode <slug> --format json --max-turns <n> "<prompt>"
#
# Authentication:
#   BOBSHELL_API_KEY env var — inference API key; Bob 2.x reads this automatically.
#   No --auth-method flag needed (that was a Bob 1.x pattern).
#
# On-prem routing:
#   BOB_GATEWAY_URL env var — Bob 2.x routes all traffic through this endpoint.
#   Set to: https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com
#
# LiteLLM/Qwen-Coder notes:
#   - NODE_TLS_REJECT_UNAUTHORIZED=0 is required (on-prem self-signed cert).
#   - LiteLLM returns HTTP 400 on the first tool-capability probe request.
#     Bob 2.0.5 treats this as a recoverable error and retries — do not add
#     --disable-tool-groups workarounds; they are not needed with 2.0.5.
#   - --max-turns 20 prevents runaway turn loops (Qwen-Coder can loop on
#     tool calls when it lacks function-calling support).
#
# Required env vars:
#   BOBSHELL_API_KEY   - Bob inference API key (from sre-credentials Secret)
#   BOB_GATEWAY_URL    - On-prem Bob API gateway URL (from sre-credentials Secret)
#   BOB_PROMPT         - The prompt string to execute
#   OUTPUT_FILE        - Path to write findings JSON on the shared PVC
#
# Optional env vars:
#   CHAT_MODE          - Bob 2.x mode slug (default: agent)
#   LOG_FILE           - Path to tee stdout/stderr (default: /workspace/agent.log)
#   INSTANA_BASE_URL, INSTANA_API_TOKEN
#   OCP_API_URL
#   SLACK_WEBHOOK_URL

set -euo pipefail

# On-prem Bob server uses a self-signed cert — disable Node.js TLS verification.
# Must be exported before the node process starts; setting it after has no effect.
export NODE_TLS_REJECT_UNAUTHORIZED=0

OUTPUT_FILE="${OUTPUT_FILE:-/workspace/output.json}"
LOG_FILE="${LOG_FILE:-/workspace/agent.log}"

# Tee all stdout+stderr to the log file on the shared PVC.
# The dashboard tails this file via chokidar to stream live agent output.
exec > >(tee -a "$LOG_FILE") 2>&1

START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[START] agent=$(basename $OUTPUT_FILE .json) ts=${START_TIME}"
echo "[entrypoint] Bob Shell 2.0.5 starting at ${START_TIME}"
echo "[entrypoint] Output file: ${OUTPUT_FILE}"
echo "[entrypoint] Chat mode: ${CHAT_MODE:-agent}"

# Ensure workspace output directory exists
mkdir -p "$(dirname "${OUTPUT_FILE}")"

# Log the on-prem gateway being used
if [ -n "${BOB_GATEWAY_URL:-}" ]; then
  echo "[entrypoint] On-prem Bob gateway: ${BOB_GATEWAY_URL}"
fi

# Run bob run — Bob 2.x headless execution.
#   --trust         marks /workspace as trusted (required for file tools)
#   --mode          selects the custom mode slug (instana/openshift-sre/infra-sre)
#   --format json   structured JSON output (includes stats and last_message)
#   --max-turns 20  guards against runaway loops on LiteLLM/Qwen-Coder
#   Auth:           BOBSHELL_API_KEY read automatically from env
#   Routing:        BOB_GATEWAY_URL read automatically from env
bob run \
    --trust \
    --mode "${CHAT_MODE:-agent}" \
    --format json \
    --max-turns 20 \
    "${BOB_PROMPT}" \
    ; BOB_EXIT=$?

END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ "${BOB_EXIT}" -ne 0 ]; then
  echo "[entrypoint] Bob exited with code ${BOB_EXIT} — writing failure sentinel to ${OUTPUT_FILE}"
  cat > "${OUTPUT_FILE}" <<EOF
{
  "status": "failed",
  "completed_at": "${END_TIME}",
  "started_at": "${START_TIME}",
  "exit_code": ${BOB_EXIT},
  "error": "Bob CLI exited with non-zero code ${BOB_EXIT}",
  "summary": "Agent failed — check pod logs for details"
}
EOF
  echo "[DONE] status=failed exit=${BOB_EXIT} ts=${END_TIME}"
  exit "${BOB_EXIT}"
fi

echo "[entrypoint] Bob completed successfully at ${END_TIME}"
echo "[DONE] status=success ts=${END_TIME}"
exit 0
