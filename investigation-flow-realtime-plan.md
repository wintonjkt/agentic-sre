# Investigation Flow — Real-Time Status & Color Plan

## Overview

The Investigation Flow DAG must always reflect the **current run's state**, not stale state from a previous run. On page load, all nodes should start as red (NOT STARTED). When investigation begins, nodes transition yellow (IN PROGRESS) → green (DONE) in real time.

### Root Cause

On every SSE connection, [`server.js /events`](dashboard/server.js:155) immediately replays all existing workspace findings files as `agent_update` events. Because findings from a previous run are still on disk, all five agents get a `success` status pushed the moment the page loads — making the DAG flash green before the investigation begins.

### Design Decisions

| Scenario | DAG Behaviour |
|---|---|
| Page load (any state) | All nodes = red, "NOT STARTED" |
| Investigation triggered | Nodes reset to red, then update in real time via SSE |
| Node running | Yellow border + pulsing glow animation, "IN PROGRESS" |
| Node complete | Green border + fill, "DONE" |
| Node failed | Red border (same as waiting but distinct fill), "FAILED" |

The SSE replay on connect is intentionally **ignored for DAG initialisation** — the DAG always starts from `waiting` and only advances via live `agent_update` events during the current run.

---

## Sub-Task 1 — Suppress stale SSE replay from updating the DAG on page load

**Intent**: The server replays existing findings files as `agent_update` events on every new SSE connection. These must not update the DAG, which should always start at `waiting` (red). The minimal fix: ignore `agent_update` SSE events that arrive before the investigation is explicitly started (i.e., before `startInvestigation()` is called). Introduce a client-side boolean flag `investigationActive` (default `false`). The SSE `agent_update` handler only calls `updateDag()` / `updateCard()` when `investigationActive` is `true`. The flag is set to `true` when `startInvestigation()` is called, and reset to `false` on a `pipeline_event reset`.

**Expected Outcomes**
- Page load: all DAG nodes stay red "NOT STARTED" regardless of what findings files exist on disk
- After "Start Investigation" click: `investigationActive` becomes `true` and subsequent SSE `agent_update` events drive the DAG in real time
- Reset event: `investigationActive` resets to `false`, DAG returns to all-red

**Todo List**
1. Declare `let investigationActive = false;` near the top of the script block (alongside `let es`, `let currentPage`, etc.).
2. In `startInvestigation()`, set `investigationActive = true` immediately before the `/api/trigger` fetch.
3. In the SSE `agent_update` handler, wrap the `updateCard()`, `updateDag()`, and `updateProgress()` calls in `if (investigationActive)`.
4. In the SSE `pipeline_event reset` handler, set `investigationActive = false` and call `updateDag(a.id, 'waiting')` for each agent (in addition to existing `renderCards()` call).
5. Remove (or keep but guard) the `loadPipelineStatus()` → DAG hydration — since DAG must always start fresh, do NOT add DAG hydration to `loadPipelineStatus()`.

**Relevant Context**
- SSE `agent_update` handler at [`index.html:1121`](dashboard/public/index.html:1121)
- `startInvestigation()` at [`index.html:1068`](dashboard/public/index.html:1068)
- SSE `pipeline_event reset` handler at [`index.html:1165`](dashboard/public/index.html:1165)
- `updateDag()` at [`index.html:789`](dashboard/public/index.html:789)

**Status**: [x] done

---

## Sub-Task 2 — Update DAG node colors: red=not started, yellow=in progress, green=done

**Intent**: Apply the three-color scheme to the SVG DAG nodes, badge text labels, and connecting edges.

| Status    | Label        | Node border        | Node fill      | Edge             |
|-----------|--------------|--------------------|----------------|------------------|
| `waiting` | NOT STARTED  | Red `#da1e28`      | Default layer  | Default grey dashed |
| `running` | IN PROGRESS  | Yellow `#f1c21b`   | Yellow `#f1c21b11` | Yellow animated dash |
| `success` | DONE         | Green `#42be65`    | Green `#42be6511`  | Green solid      |
| `failed`  | FAILED       | Red `#da1e28`      | Red `#da1e2811`    | Red solid        |

The `waiting` and `failed` states share the same red border color. The `waiting` node has no fill tint; `failed` has a red fill tint to distinguish them visually.

**Expected Outcomes**
- Default (waiting) nodes: red border, no fill tint, "NOT STARTED" badge text
- Running nodes: yellow border, yellow pulsing glow animation, yellow fill tint, "IN PROGRESS" badge
- Success nodes: green border, green fill tint, "DONE" badge
- Edges animate yellow while the downstream node is running, turn green when done

**Todo List**
1. In the `/* SVG DAG */` CSS block, update `.dag-node rect` default `stroke` to red `#da1e28` to represent the initial/waiting state.
2. Add an explicit `.dag-node.waiting rect` rule with `stroke: #da1e28` (same as default, but ensures the class applied by `updateDag` is consistent).
3. Update `.dag-node.running rect` stroke from `#0f62fe` to `#f1c21b`, add `fill: #f1c21b11`.
4. Update the `node-pulse` keyframe animation shadow color from `#0f62fe88` to `#f1c21b88`.
5. Keep `.dag-node.success rect` green as-is.
6. Update `.dag-edge.active` stroke from `#0f62fe66` to `#f1c21b99`.
7. Update `badgeLabel()` to return: `waiting` → `'NOT STARTED'`, `running` → `'IN PROGRESS'`, `success` → `'DONE'`, `failed` → `'FAILED'`.
8. Update the five static SVG `<text id="dag-badge-*">` elements from `WAITING` to `NOT STARTED`.

**Relevant Context**
- CSS block at [`index.html:113`](dashboard/public/index.html:113)
- `node-pulse` keyframe at [`index.html:125`](dashboard/public/index.html:125)
- `badgeLabel()` at [`index.html:708`](dashboard/public/index.html:708)
- SVG badge `<text>` elements at [`index.html:498`](dashboard/public/index.html:498), [505](dashboard/public/index.html:505), [512](dashboard/public/index.html:512), [519](dashboard/public/index.html:519), [527](dashboard/public/index.html:527)

**Status**: [x] done

---

## Sub-Task 3 — Update badge and card colors to match the new scheme

**Intent**: The `.badge-*` classes (used in agent cards on Page 2) and `.ps-badge` classes (used on the Page 1 pre-flight rows) must reflect the same red/yellow/green scheme so the whole UI is visually consistent.

**Expected Outcomes**
- Agent card badges: `waiting` → red-toned, `running` → yellow-toned, `success` → green (unchanged), `failed` → red (unchanged)
- Page 1 pre-flight `.ps-badge`: same color mapping
- Agent card top border (`border-top-color`) for `running` state: yellow instead of blue

**Todo List**
1. Update `.badge-waiting` to `background: #da1e2822; color: #ff8389` (red tones).
2. Update `.badge-running` to `background: #f1c21b22; color: #f1c21b` (yellow tones), keep the `badge-blink` animation.
3. Update `.agent-card.status-running` `border-top-color` from `#0f62fe` to `#f1c21b`.
4. Update `.ps-badge.waiting` to `background: #da1e2822; color: #ff8389`.
5. Update `.ps-badge.running` to `background: #f1c21b22; color: #f1c21b`.

**Relevant Context**
- `.badge-*` rules at [`index.html:141`](dashboard/public/index.html:141)
- `.agent-card.status-running` at [`index.html:134`](dashboard/public/index.html:134)
- `.ps-badge` rules at [`index.html:94`](dashboard/public/index.html:94)

**Status**: [x] done
