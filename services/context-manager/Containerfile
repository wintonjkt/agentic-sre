FROM registry.access.redhat.com/ubi9/nodejs-20:latest

WORKDIR /opt/app-root/src

COPY package*.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
COPY public/ ./public/
RUN npm run build && npm prune --omit=dev

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
