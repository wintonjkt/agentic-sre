FROM node:22-alpine
WORKDIR /app

# Build context must be workspace root: podman/docker build -f services/bob-chat-ui/Dockerfile .
COPY services/bob-chat-ui/package*.json ./
RUN npm ci --omit=dev

COPY services/bob-chat-ui/server.js ./
COPY services/bob-chat-ui/public/ ./public/

ENV PORT=3001 \
    NODE_ENV=production \
    CONTEXT_MANAGER_URL=http://context-manager:8080 \
    SAVED_PROMPTS_DIR=/workspace/saved-prompts

EXPOSE 3001

# Run as non-root — OpenShift restricted SCC compatible
USER 1001

CMD ["node", "server.js"]
