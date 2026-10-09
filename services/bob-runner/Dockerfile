FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

USER 0

# Install Node.js 22 from Nodesource + git, tar, ca-certificates, python3 (for mode baking)
RUN microdnf install -y tar gzip ca-certificates shadow-utils python3 python3-pip python3-pyyaml && \
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && \
    microdnf install -y nodejs git && \
    microdnf clean all

# Copy and install bobshell CLI globally (2.0.2 — closest version to on-prem Bob server 2.0.0)
# Build context must be workspace root: podman build -f services/bob-runner/Dockerfile .
COPY container/bobshell-2.0.2.tgz /tmp/
RUN npm install -g /tmp/bobshell-2.0.2.tgz && rm -f /tmp/bobshell-2.0.2.tgz

WORKDIR /opt/app-root/src

COPY services/bob-runner/package*.json services/bob-runner/tsconfig.json ./
RUN npm install

COPY services/bob-runner/src/ ./src/
RUN npm run build && npm prune --omit=dev

# ── Bob home: world-writable, arbitrary-UID safe (matches container/Dockerfile pattern) ──
# Bob 2.x writes session state to HOME/.bob — must be writable by any UID.
ENV HOME=/bob-home \
    BOB_GATEWAY_URL="" \
    BOB_WORKSPACE=/tmp/bob-workspace \
    PORT=8081 \
    NODE_ENV=production

RUN mkdir -p /bob-home/.bob/settings /tmp/bob-workspace && \
    chmod -R 777 /bob-home && \
    chmod -R g=u /opt/app-root /tmp/bob-workspace /tmp

# ── Bake in custom SRE modes (instana / openshift-sre / infra-sre) ──
COPY .bob/modes/ /tmp/bob-modes/
RUN python3 - <<'PYEOF'
import glob, yaml
entries = []
for f in sorted(glob.glob('/tmp/bob-modes/*.yaml')):
    with open(f) as fh:
        entries.append(yaml.safe_load(fh))
with open('/bob-home/.bob/settings/custom_modes.yaml', 'w') as out:
    yaml.dump({'customModes': entries}, out, default_flow_style=False, allow_unicode=True)
print(f"Wrote {len(entries)} mode(s)")
PYEOF

# ── Pre-accept license ──
RUN echo '{"licenseConsent":true,"approval":{"forbiddenApprovalGroups":[]}}' \
    > /bob-home/.bob/settings/settings.json

USER 1001

EXPOSE 8081

CMD ["node", "dist/index.js"]
