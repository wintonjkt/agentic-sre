# Architecture & Implementation Plan: Chat Assistant with Bob Shell on OpenShift

## Top-Level Overview
Design and deploy a containerized chat assistant on Red Hat OpenShift Container Platform (OCP). The solution uses a Node.js/TypeScript (Fastify) application to manage conversation state, history pruning, and memory erasure in Redis, and dispatches assembled prompts to the Bob Shell CLI runner in non-interactive mode.

---

## Architecture Diagram

```
+-----------------------------------------------------------------------------------------+
|                                    OpenShift Cluster                                    |
|                                                                                         |
|   +---------------------+        +--------------------------------------------------+   |
|   |   OpenShift Route   | -----> |         Fastify Application (Node.js/TS)         |   |
|   +---------------------+        |  - Chat API & WebSocket/SSE streaming            |   |
|                                  |  - Context Assembler & Memory Eraser             |   |
|                                  +--------+----------------------------+------------+   |
|                                           |                            |                |
|                                           v                            v                |
|                                  +-----------------+         +---------------------+    |
|                                  |   Redis Store   |         |  Bob Shell Runner   |    |
|                                  |  (Session/State)|         | (CLI Subprocess)    |    |
|                                  +-----------------+         +---------------------+    |
+-----------------------------------------------------------------------------------------+
```

---

## Sub-Tasks

### 1. Context & Memory Service (Node.js/Fastify + Redis)
- **Intent**: Provide REST/SSE/WebSocket endpoints to accept user prompts, retrieve/update chat context from Redis, support memory deletion, and construct the prompt payload for Bob Shell.
- **Expected Outcomes**:
  - `POST /api/chat`: Handles conversation turns, appends history, calls the Bob Shell runner, and returns the response.
  - `DELETE /api/chat/memory/:sessionId`: Erases all context/history for a specific session.
  - `GET /api/chat/history/:sessionId`: Retrieves active conversation history.
- **Todo List**:
  - [ ] Initialize Fastify TypeScript service scaffold.
  - [ ] Implement Redis client connection and session state repository.
  - [ ] Implement memory pruning/windowing logic and prompt formatting.
  - [ ] Implement session memory flush/erase route.
- **Status**: `[ ] pending`

### 2. Bob Shell Execution Service (Microservice / Sidecar)
- **Intent**: Provide a dedicated lightweight execution runner service that executes Bob Shell non-interactively (`bob -p "<prompt>"`) and exposes an internal HTTP endpoint for prompt dispatch.
- **Expected Outcomes**:
  - Independent Bob Shell runner container with an internal API (e.g. `POST /run`).
  - Child process spawning with timeout, buffer streaming, and error handling.
- **Todo List**:
  - [ ] Create Bob Shell runner service entrypoint with execution endpoint.
  - [ ] Implement Node.js `child_process.spawn` wrapper for the `bob` CLI with stdout streaming.
  - [ ] Configure Bob execution parameters and environment variables.
- **Status**: `[ ] pending`

### 3. Containerization (Split Containers, UBI-based)
- **Intent**: Build OpenShift-compliant UBI 9 container images for both the Fastify App (Context/Memory Manager) and the Bob Shell Runner.
- **Expected Outcomes**:
  - `Containerfile.app`: Fastify orchestrator image.
  - `Containerfile.bob-runner`: Bob Shell execution image.
  - Full compatibility with OpenShift `restricted-v2` SCC (non-root execution, `chmod -R g=u`).
- **Todo List**:
  - [ ] Create `Containerfile.app` based on `ubi9/nodejs-20`.
  - [ ] Create `Containerfile.bob-runner` with Bob CLI installed.
  - [ ] Configure arbitrary non-root UID file permissions.
- **Status**: `[ ] pending`

### 4. OpenShift Manifests & Deployment
- **Intent**: Deploy the Fastify app, Bob Shell runner (sidecar or separate service), Redis instance, ConfigMaps, Secrets, and Routes onto OpenShift.
- **Expected Outcomes**:
  - OpenShift Deployment manifests for App, Runner, and Redis.
  - Secure OpenShift Route with TLS termination.
  - Bob API credentials and environment configuration stored in Secrets & ConfigMaps.
- **Todo List**:
  - [ ] Create `Secret` for Bob credentials.
  - [ ] Create `ConfigMap` for Redis and runner endpoints.
  - [ ] Create `Deployment` for Fastify Context Manager and Bob Shell Runner.
  - [ ] Create Redis deployment or service manifest.
  - [ ] Create `Service` and `Route` manifests.
- **Status**: `[ ] pending`
