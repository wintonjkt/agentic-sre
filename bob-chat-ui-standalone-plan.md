# Plan: Bob Chat UI — Standalone Lightweight Web Interface

## Top-Level Overview

Build a **standalone, zero-build-step chat UI** as a new OpenShift service (`bob-chat-ui`) in the `sre-demo` namespace. The UI is a single Express server that serves one HTML page (vanilla JS + CSS, no React or transpilation). Users type prompts into a chat input, responses stream back from the existing `context-manager` `/api/chat` endpoint (which proxies through `bob-runner` → Bob Shell on-premise). A sidebar shows saved prompts stored as `.txt` files on the shared PVC at `/workspace/saved-prompts/`, allowing one-click insertion and saving of new named prompts.

**Architecture:**
```
Browser
  └── bob-chat-ui (Express, port 3001)
        ├── GET  /                        → serves index.html (chat UI)
        ├── POST /api/proxy/chat          → proxies to context-manager /api/chat
        ├── GET  /api/prompts             → lists .txt files from /workspace/saved-prompts/
        ├── POST /api/prompts             → writes new .txt file to /workspace/saved-prompts/
        └── DELETE /api/prompts/:name    → deletes .txt file from /workspace/saved-prompts/
            ↓
        context-manager Service (port 8080)
            └── /api/chat → bob-runner → Bob Shell on-premise
```

**Deployment target:** `sre-demo` namespace, OpenShift. Built via a new `BuildConfig` sourcing from `services/bob-chat-ui/` in the same GitHub repo. Exposes a TLS-terminated Route.

---

## Sub-Tasks

---

### 1. Express Server with Proxy & Prompt File API

**Intent:** Create `services/bob-chat-ui/` — a minimal Node.js Express server that serves the static HTML page and exposes three REST endpoints: a chat proxy (to context-manager), and saved-prompt CRUD backed by PVC files.

**Expected Outcomes:**
- `services/bob-chat-ui/server.js` is a single runnable file (CommonJS, no TypeScript).
- `GET /` returns the chat HTML page.
- `POST /api/proxy/chat` accepts `{ sessionId, prompt, mode, approvalMode, systemInstruction }` and proxies to `http://${CONTEXT_MANAGER_URL}/api/chat`, returning the raw JSON response.
- `GET /api/prompts` reads `/workspace/saved-prompts/` and returns an array of `{ name, content }` objects (one per `.txt` file).
- `POST /api/prompts` accepts `{ name, content }` and writes `name.txt` to `/workspace/saved-prompts/`.
- `DELETE /api/prompts/:name` deletes the named `.txt` file from `/workspace/saved-prompts/`.
- Graceful fallback when `/workspace/saved-prompts/` doesn't exist (returns empty array; creates dir on first save).

**Todo List:**
- [ ] Create `services/bob-chat-ui/` directory with `package.json` (dependencies: `express`, `node-fetch` or `axios`).
- [ ] Implement `server.js` with the five routes above.
- [ ] Add `CONTEXT_MANAGER_URL` env var (default: `http://context-manager:8080`).
- [ ] Add `SAVED_PROMPTS_DIR` env var (default: `/workspace/saved-prompts`).
- [ ] Add `PORT` env var (default: `3001`).
- [ ] Auto-create `SAVED_PROMPTS_DIR` if it does not exist on startup.

**Relevant Context:**
- Pattern reference: [`dashboard/server.js`](dashboard/server.js) — minimal Express server in this project.
- Proxy target: [`services/context-manager/src/index.ts`](services/context-manager/src/index.ts) — `/api/chat` POST endpoint.
- Shared PVC mount path: `/workspace` (all jobs use this; see [`manifests/job-instana-query.yaml`](manifests/job-instana-query.yaml)).

**Status:** `[x] done`

---

### 2. Chat UI HTML Page (Vanilla JS)

**Intent:** Build the single-file HTML chat UI. No build step, no framework dependencies. The page renders a chat history, an input area, and a saved-prompts sidebar, all using `fetch` to call the Express proxy endpoints.

**Expected Outcomes:**
- `services/bob-chat-ui/public/index.html` is a self-contained page with inline CSS and JS.
- Chat panel shows alternating user / Bob messages with timestamps; Bob messages render Markdown (using a CDN `marked.js` script tag).
- Input area has a multi-line textarea and a Send button; pressing Enter sends, Shift+Enter adds newline.
- A loading indicator ("Bob is thinking…") appears while the request is in-flight; input is disabled.
- Saved Prompts sidebar (left column) lists each saved prompt by name; clicking one inserts its content into the textarea.
- "Save Prompt" button opens an inline modal/overlay asking for a name, then POSTs to `/api/prompts`.
- "Delete" icon next to each saved prompt calls `DELETE /api/prompts/:name` and refreshes the list.
- Session ID is auto-generated on first page load and stored in `sessionStorage`; persists across tab refreshes but not across tabs.
- Dark theme by default, styled to match the project's existing Carbon g100 color variables where feasible (CSS custom properties).

**Todo List:**
- [ ] Create `services/bob-chat-ui/public/index.html`.
- [ ] Implement two-column layout: saved-prompts sidebar (left, ~260px), chat panel (right, flex-1).
- [ ] Implement `sendMessage()` function using `fetch POST /api/proxy/chat`.
- [ ] Implement `loadSavedPrompts()` / `savePrompt()` / `deletePrompt()` using the `/api/prompts` endpoints.
- [ ] Add CDN script tag for `marked.js` to render Markdown in assistant messages.
- [ ] Style using CSS variables with IBM Carbon g100 dark palette (no external CSS dependencies).

**Relevant Context:**
- Color palette reference: [`services/frontend/src/styles/global.scss`](services/frontend/src/styles/global.scss) — Carbon tokens already defined.
- Existing message bubble pattern: [`services/frontend/src/components/ChatThread.tsx`](services/frontend/src/components/ChatThread.tsx).
- Existing session management pattern: [`services/frontend/src/App.tsx`](services/frontend/src/App.tsx) — `session-${Date.now().toString(36)}` ID format.

**Status:** `[x] done`

---

### 3. Dockerfile

**Intent:** Package the Express server and HTML page into a minimal container image.

**Expected Outcomes:**
- `services/bob-chat-ui/Dockerfile` produces a lean image based on `node:22-alpine`.
- Only production dependencies installed (`npm ci --omit=dev`).
- `public/index.html` is copied alongside `server.js`.
- Container listens on port `3001`; runs as non-root user.
- Image compatible with OpenShift's restricted SCC (no root requirement).

**Todo List:**
- [ ] Create `services/bob-chat-ui/Dockerfile` using `node:22-alpine` base.
- [ ] `COPY package*.json ./` → `npm ci --omit=dev` → `COPY server.js public/ ./`.
- [ ] Set `USER 1001` and `EXPOSE 3001`.
- [ ] Verify the Dockerfile follows the same pattern as [`dashboard/Dockerfile`](dashboard/Dockerfile).

**Relevant Context:**
- Pattern reference: [`dashboard/Dockerfile`](dashboard/Dockerfile) — the existing Alpine-based minimal Node.js container.

**Status:** `[x] done`

---

### 4. OpenShift Manifests (Deployment, Service, Route, BuildConfig)

**Intent:** Deploy the new `bob-chat-ui` service into the `sre-demo` namespace, connecting it to the PVC for saved-prompts storage and wiring it to the existing `context-manager` service.

**Expected Outcomes:**
- `manifests/bob-chat-ui.yaml` contains: `ImageStream`, `BuildConfig`, `Deployment`, `Service`, and `Route` in one file.
- `BuildConfig` sources from `services/bob-chat-ui/` in the GitHub repo.
- `Deployment` mounts the `sre-workspace` PVC at `/workspace`.
- `Deployment` sets `CONTEXT_MANAGER_URL=http://context-manager:8080`.
- `Route` exposes HTTPS with edge TLS termination (same pattern as `sre-dashboard`).
- `resources` limits match the dashboard service (100m/128Mi requests, 500m/512Mi limits).

**Todo List:**
- [ ] Create `manifests/bob-chat-ui.yaml`.
- [ ] Add `ImageStream` for `bob-chat-ui`.
- [ ] Add `BuildConfig` pointing to `contextDir: services/bob-chat-ui`.
- [ ] Add `Deployment` with PVC mount and env vars (`CONTEXT_MANAGER_URL`, `SAVED_PROMPTS_DIR`, `PORT`).
- [ ] Add `Service` on port `3001`.
- [ ] Add `Route` with edge TLS, matching the pattern in [`manifests/dashboard-deployment.yaml`](manifests/dashboard-deployment.yaml).

**Relevant Context:**
- Pattern reference: [`manifests/dashboard-deployment.yaml`](manifests/dashboard-deployment.yaml) — Deployment + Service + Route with PVC mount.
- BuildConfig pattern: [`manifests/dashboard-buildconfig.yaml`](manifests/dashboard-buildconfig.yaml).
- PVC name: `sre-workspace` (defined in [`manifests/pvc.yaml`](manifests/pvc.yaml)).
- Namespace: `sre-demo`.
- GitHub repo: `https://github.com/wintonjkt/agentic-sre.git`, branch `main`.

**Status:** `[x] done`

---

### 5. Wire Deploy Script & Update run-demo.sh

**Intent:** Make the new service part of the standard deployment so it's applied alongside the rest of the stack.

**Expected Outcomes:**
- `manifests/run-demo.sh` applies `bob-chat-ui.yaml`.
- A short note in `manifests/run-demo.sh` explains what route URL the chat UI will be available at after build.
- `manifests/cleanup.sh` knows to delete `bob-chat-ui` resources.

**Todo List:**
- [ ] Add `oc apply -f bob-chat-ui.yaml` to `manifests/run-demo.sh` (after context-manager manifest, before Jobs).
- [ ] Add `oc delete -f bob-chat-ui.yaml --ignore-not-found` to `manifests/cleanup.sh`.
- [ ] Add `oc start-build bob-chat-ui` trigger at the end of `run-demo.sh` (alongside the existing build triggers).

**Relevant Context:**
- [`manifests/run-demo.sh`](manifests/run-demo.sh) — existing deploy script.
- [`manifests/cleanup.sh`](manifests/cleanup.sh) — existing cleanup script.

**Status:** `[x] done`
