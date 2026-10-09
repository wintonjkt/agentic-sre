FROM node:22-alpine
WORKDIR /app

# Install oc CLI (needed by /api/trigger to apply job manifests)
# gcompat provides glibc compatibility layer needed by oc (glibc binary on Alpine/musl)
RUN apk add --no-cache curl tar gcompat && \
    curl -fsSL https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz \
    | tar -xz -C /usr/local/bin oc kubectl && \
    chmod +x /usr/local/bin/oc /usr/local/bin/kubectl && \
    oc version --client

COPY dashboard/package.json ./
RUN npm install --omit=dev
COPY dashboard/server.js ./
COPY dashboard/public/ ./public/
# Bake in the job manifests so /api/trigger can apply them
COPY manifests/ /manifests/
EXPOSE 3000
ENV WORKSPACE_DIR=/workspace
CMD ["node", "server.js"]
