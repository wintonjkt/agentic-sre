# =============================================================================
# SRE Bob CLI Container Image
# Base: node:22-slim (Debian bookworm-slim) — Bob Shell 2.x requires Node.js 18+
# Bob Shell version: 2.0.5
# =============================================================================
# Auth: BOBSHELL_API_KEY env var (inference API key) — Bob 2.x reads this
#       automatically via `bob run`; no --auth-method flag needed.
# Routing: BOB_GATEWAY_URL env var points bob run to the on-prem Bob server.
#   On-prem URL: https://api.bob.ibm-bob.apps.itz-h7532y.infra01-lb.tok04.techzone.ibm.com
# TLS: NODE_TLS_REJECT_UNAUTHORIZED=0 is set in entrypoint.sh — the on-prem
#   server uses a self-signed cert. LiteLLM/Qwen-Coder returns a 400 on the
#   first tool-capability probe; Bob 2.0.5 handles this as a recoverable error
#   and retries successfully (fixed in 2.0.5: "Session no longer ends on
#   recoverable errors").
# Modes: Bob 2.x uses `execute` group (not 1.x `command`) for shell tool access.
#   Custom modes are baked into /bob-home/.bob/settings/custom_modes.yaml at build.
#
# Required environment variables at runtime:
#   BOBSHELL_API_KEY    - Bob Shell inference API key for headless auth
#   BOB_GATEWAY_URL     - On-prem Bob API gateway URL (injected from Secret)
#   CHAT_MODE           - Bob 2.x mode slug (instana / openshift-sre / infra-sre)
#   BOB_PROMPT          - The prompt string to execute
#   OUTPUT_FILE         - Path to write findings JSON on the shared PVC
#
# Optional environment variables:
#   INSTANA_BASE_URL    - Instana instance base URL
#   INSTANA_API_TOKEN   - Instana API token
#   OCP_API_URL         - OpenShift API server URL
#   SLACK_WEBHOOK_URL   - Slack incoming webhook (optional notification)
# =============================================================================

FROM node:22-slim

LABEL maintainer="Agentic SRE Demo"
LABEL description="Bob Shell 2.0.5 CLI with SRE tooling for OpenShift-native agentic RCA"

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    jq \
    python3 \
    python3-pip \
    python3-venv \
    ansible \
    && rm -rf /var/lib/apt/lists/*

# ── Python requests library (Instana API scripting) ──────────────────────────
RUN pip3 install --break-system-packages requests

# ── OpenShift CLI (oc) ───────────────────────────────────────────────────────
# Download latest stable oc for linux amd64 from the OpenShift mirror
RUN curl -fsSL https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz \
    | tar -xz -C /usr/local/bin oc kubectl \
    && chmod +x /usr/local/bin/oc /usr/local/bin/kubectl \
    && oc version --client

# ── Bob Shell 2.0.5 CLI ───────────────────────────────────────────────────────
# Install from bundled tarball — avoids interactive installer and outbound auth
# to bob.ibm.com at build time.
# Key 2.x changes vs 1.x:
#   - `bob run` replaces `bob -p` for headless execution
#   - `execute` group replaces `command` group in custom modes
#   - BOBSHELL_API_KEY env var replaces --auth-method api-key flag
#   - BOB_GATEWAY_URL env var routes to on-prem server (no extra CLI flag)
#   - licenseConsent pre-baked in settings.json (no --accept-license needed)
COPY container/bobshell-2.0.5.tgz /tmp/bobshell.tgz
RUN npm install --reg=https://registry.npmjs.org/ -g /tmp/bobshell.tgz \
    && rm /tmp/bobshell.tgz \
    && bob --version

# ── Bob modes (baked into /bob-home — a world-writable non-root path) ─────────
# Bob 2.x reads ~/.bob/settings/custom_modes.yaml (customModes array).
# We use /bob-home as HOME so OpenShift arbitrary UIDs can always write there,
# and the pre-baked modes/settings are never shadowed by an emptyDir mount.
# All modes use `execute` group (Bob 2.x) — NOT the 1.x `command` group.
ENV HOME=/bob-home
# BOB_GATEWAY_URL is injected at runtime from the sre-credentials Secret.
# Setting a blank default here makes it visible during image inspection.
ENV BOB_GATEWAY_URL=""
RUN mkdir -p /bob-home/.bob/settings && chmod -R 777 /bob-home
COPY .bob/modes/ /tmp/bob-modes/
RUN python3 - <<'PYEOF'
import os, yaml, glob

entries = []
for f in sorted(glob.glob('/tmp/bob-modes/*.yaml')):
    with open(f) as fh:
        doc = yaml.safe_load(fh)
    entries.append(doc)

with open('/bob-home/.bob/settings/custom_modes.yaml', 'w') as out:
    yaml.dump({'customModes': entries}, out, default_flow_style=False, allow_unicode=True)

print(f"Wrote {len(entries)} mode(s) to /bob-home/.bob/settings/custom_modes.yaml")
PYEOF

# ── Pre-accept license and configure approval settings ───────────────────────
# licenseConsent:true means no --accept-license flag needed at runtime.
# forbiddenApprovalGroups:[] allows all tool groups including execute.
RUN echo '{"licenseConsent":true,"approval":{"forbiddenApprovalGroups":[]}}' \
    > /bob-home/.bob/settings/settings.json

# ── Prompts ──────────────────────────────────────────────────────────────────
RUN mkdir -p /prompts

COPY container/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Working directory ────────────────────────────────────────────────────────
WORKDIR /workspace

# ── Default entrypoint ───────────────────────────────────────────────────────
# Reads CHAT_MODE, BOB_PROMPT, OUTPUT_FILE from the OpenShift Job spec env vars.
ENTRYPOINT ["/entrypoint.sh"]
