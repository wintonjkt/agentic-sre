# Architecture & Implementation Plan: Carbon Chat UI & Advanced Context/Memory Management

## Top-Level Overview
Design and implement a responsive, enterprise-grade Web Chat UI using IBM Carbon Design System (@carbon/react) integrated with our OpenShift-hosted backend. The interface will provide conversational streaming/turns, active session management, context inspection, memory pruning/wiping, and runtime execution configuration (mode, approval mode, system instructions).

---

## Architecture Diagram

```
+-----------------------------------------------------------------------------------------+
|                                    User Browser                                         |
|                                                                                         |
|   +---------------------------------------------------------------------------------+   |
|   |                      IBM Carbon React Single Page Application                   |   |
|   |  - Header & Global Navigation (Session switcher, theme toggle)                  |   |
|   |  - Chat Thread (User / Assistant messages, markdown rendering, code copying)    |   |
|   |  - Context & Memory Inspector Panel (Redis state, token stats, erase action)    |   |
|   |  - Bob Configuration Drawer (Approval mode, execution mode, system prompt)      |   |
|   +---------------------------------------------------------------------------------+   |
|                                           |                                             |
|                                           v HTTPS                                       |
|   +---------------------------------------------------------------------------------+   |
|   |                     OpenShift Route (Edge TLS Termination)                      |   |
|   +---------------------------------------------------------------------------------+   |
|                                           |                                             |
|                                           v                                             |
|   +---------------------------------------------------------------------------------+   |
|   |                 Context & Memory Manager Service (Fastify / Node.js)            |   |
|   |  - /api/chat (prompt execution + context synthesis)                             |   |
|   |  - /api/chat/history/:sessionId (retrieval)                                     |   |
|   |  - /api/chat/memory/:sessionId (flush/erase)                                    |   |
|   |  - Static asset serving for Carbon UI build                                     |   |
|   +---------------------------------------------------------------------------------+   |
+-----------------------------------------------------------------------------------------+
```

---

## Sub-Tasks

### 1. UI Scaffold & Carbon Design System Integration
- **Intent**: Set up the React/TypeScript frontend with Carbon Design System components (`@carbon/react`, `@carbon/icons-react`, `@carbon/styles`).
- **Expected Outcomes**:
  - React single-page app scaffold built with Vite for optimal build speeds.
  - IBM Carbon shell layout (`Header`, `HeaderName`, `HeaderGlobalBar`, `SideNav`, `Theme`).
  - Dark/Light Carbon theme toggle (g100 / g10).
- **Todo List**:
  - [ ] Initialize React + TypeScript application in `services/frontend` using Vite.
  - [ ] Install `@carbon/react`, `@carbon/icons-react`, and Carbon styles.
  - [ ] Implement Carbon application header, navigation bar, and main container layout.
- **Status**: `[x] done`

### 2. Conversational Interface & Message Rendering
- **Intent**: Provide an interactive chat experience with Markdown formatting, code block syntax highlighting, message statuses, and auto-scrolling.
- **Expected Outcomes**:
  - Chat stream with clear distinction between User and Bob Assistant turns.
  - Formatted code snippets with one-click copy buttons and syntax highlighting.
  - Carbon `TextArea`, `Button`, and loading skeleton indicators while Bob is thinking.
- **Todo List**:
  - [x] Implement `ChatMessage` component supporting Markdown parsing and code blocks.
  - [x] Implement `ChatInput` area with multi-line expand, keyboard shortcuts (Enter to send, Shift+Enter for newline).
  - [x] Implement session loading states and error toast notifications using Carbon `ToastNotification`.
- **Status**: `[x] done`

### 3. Session, Memory & Context Management Panel
- **Intent**: Provide visual transparency into the conversation memory and allow users to inspect and erase context.
- **Expected Outcomes**:
  - Right-hand side panel showing active Redis session keys, memory turn count, and token estimate.
  - Session switcher to jump between conversations.
  - Explicit "Erase Memory / Clear Context" confirmation modal with Carbon `Modal`.
- **Todo List**:
  - [x] Implement `SessionSidebar` to list previous sessions and start new chats.
  - [x] Implement `ContextInspector` tab displaying stored history from `GET /api/chat/history/:sessionId`.
  - [x] Implement "Erase Context" button triggering `DELETE /api/chat/memory/:sessionId` with immediate UI cache reset.
- **Status**: `[x] done`

### 4. Bob Shell Runtime Configuration Panel
- **Intent**: Allow users to configure execution parameters dynamically per session or request.
- **Expected Outcomes**:
  - Configuration Drawer / Settings modal with Carbon form controls.
  - Controls for:
    - Bob Mode (`code`, `ask`, `plan`, `advanced`).
    - Approval Mode (`default` non-destructive vs `yolo` execution).
    - Custom System Instructions / Persona override.
    - Context Window Size (number of previous turns included in synthesis).
- **Todo List**:
  - [x] Build `ConfigDrawer` component with Carbon `Select`, `Toggle`, and `TextArea`.
  - [x] Store user preferences in `localStorage` and sync into API request payloads.
  - [x] Pass configured flags to the context-manager and runner pipeline.
- **Status**: `[x] done`

### 5. Build, Static Asset Serving & OpenShift Re-deployment
- **Intent**: Bundle the frontend into production assets and serve them either directly via the Fastify context-manager or an NGINX container.
- **Expected Outcomes**:
  - Fastify service updated with `@fastify/static` to serve the production UI bundle.
  - Updated Containerfile and build trigger in OpenShift.
  - Single OpenShift Route serving both the UI and the API.
- **Todo List**:
  - [x] Integrate `@fastify/static` in `services/context-manager` pointing to `dist/public`.
  - [x] Update build workflow in `services/context-manager/Dockerfile` to compile frontend assets during container build.
  - [x] Trigger OpenShift build (`oc start-build context-manager`) and verify live UI route.
- **Status**: `[x] done`
