'use strict';
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(express.json());

const PORT                = parseInt(process.env.PORT                || '3001', 10);
const CONTEXT_MANAGER_URL = process.env.CONTEXT_MANAGER_URL          || 'http://context-manager-service:8080';
const SAVED_PROMPTS_DIR   = process.env.SAVED_PROMPTS_DIR             || '/workspace/saved-prompts';

// Auto-create saved-prompts directory on startup (non-fatal if PVC not mounted)
try {
  fs.mkdirSync(SAVED_PROMPTS_DIR, { recursive: true });
} catch (e) {
  console.warn(`[bob-chat-ui] Could not create SAVED_PROMPTS_DIR: ${e.message}`);
}

// ── Health probe ────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// ── Serve chat UI ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Chat proxy — forwards to context-manager /api/chat ──────────────────────
app.post('/api/proxy/chat', async (req, res) => {
  const { sessionId, prompt, mode, approvalMode, systemInstruction } = req.body;

  if (!sessionId || !prompt) {
    return res.status(400).json({ error: 'sessionId and prompt are required' });
  }

  try {
    const response = await axios.post(
      `${CONTEXT_MANAGER_URL}/api/chat`,
      { sessionId, prompt, mode, approvalMode, systemInstruction },
      { timeout: 180000 }
    );
    return res.json(response.data);
  } catch (err) {
    const status  = err.response?.status  || 502;
    const details = err.response?.data    || err.message;
    console.error('[bob-chat-ui] Chat proxy error:', details);
    return res.status(status).json({ error: 'Chat request failed', details });
  }
});

// ── Saved Prompts: GET — list all saved prompts ──────────────────────────────
app.get('/api/prompts', (_req, res) => {
  try {
    if (!fs.existsSync(SAVED_PROMPTS_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(SAVED_PROMPTS_DIR)
      .filter(f => f.endsWith('.txt'))
      .sort();
    const prompts = files.map(f => {
      const name    = f.replace(/\.txt$/, '');
      const content = fs.readFileSync(path.join(SAVED_PROMPTS_DIR, f), 'utf8');
      return { name, content };
    });
    return res.json(prompts);
  } catch (e) {
    console.error('[bob-chat-ui] Failed to list prompts:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Saved Prompts: POST — save a named prompt ────────────────────────────────
app.post('/api/prompts', (req, res) => {
  const { name, content } = req.body;

  if (!name || typeof content !== 'string') {
    return res.status(400).json({ error: 'name and content are required' });
  }

  // Sanitise: allow only alphanumeric, dash, underscore, space (prevent path traversal)
  const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
  if (!safeName) {
    return res.status(400).json({ error: 'Invalid prompt name' });
  }

  try {
    fs.mkdirSync(SAVED_PROMPTS_DIR, { recursive: true });
    const filePath = path.join(SAVED_PROMPTS_DIR, `${safeName}.txt`);
    fs.writeFileSync(filePath, content, 'utf8');
    return res.json({ saved: true, name: safeName });
  } catch (e) {
    console.error('[bob-chat-ui] Failed to save prompt:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Saved Prompts: DELETE — remove a named prompt ────────────────────────────
app.delete('/api/prompts/:name', (req, res) => {
  const safeName = req.params.name.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
  const filePath = path.join(SAVED_PROMPTS_DIR, `${safeName}.txt`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  try {
    fs.unlinkSync(filePath);
    return res.json({ deleted: true, name: safeName });
  } catch (e) {
    console.error('[bob-chat-ui] Failed to delete prompt:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[bob-chat-ui] Listening on port ${PORT}`);
  console.log(`[bob-chat-ui] Context manager: ${CONTEXT_MANAGER_URL}`);
  console.log(`[bob-chat-ui] Saved prompts dir: ${SAVED_PROMPTS_DIR}`);
});
