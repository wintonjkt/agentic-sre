import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import axios from "axios";
import { MemoryStore, ChatMessage } from "./memory";

const app = Fastify({ logger: true });

const BOB_RUNNER_URL = process.env.BOB_RUNNER_URL || "http://localhost:8081";
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

const publicPath = path.resolve(__dirname, "../public");

async function buildApp() {
  await app.register(cors, { origin: "*" });

  if (fs.existsSync(publicPath)) {
    await app.register(fastifyStatic, {
      root: publicPath,
      prefix: "/",
    });
  }

  // Health check endpoint
  app.get("/healthz", async () => ({ status: "ok" }));

  // Get current conversation history for a session
  app.get<{ Params: { sessionId: string } }>("/api/chat/history/:sessionId", async (req, reply) => {
    const { sessionId } = req.params;
    const history = await MemoryStore.getHistory(sessionId);
    return reply.send({ sessionId, history });
  });

  // Erase memory/context for a session
  app.delete<{ Params: { sessionId: string } }>("/api/chat/memory/:sessionId", async (req, reply) => {
    const { sessionId } = req.params;
    const success = await MemoryStore.eraseMemory(sessionId);
    return reply.send({ sessionId, erased: success, message: "Session memory cleared." });
  });

  // Main chat endpoint
  app.post<{
    Body: {
      sessionId: string;
      prompt: string;
      systemInstruction?: string;
      mode?: string;
      approvalMode?: string;
      clearMemoryFirst?: boolean;
    };
  }>("/api/chat", async (req, reply) => {
    const { sessionId, prompt, systemInstruction, mode = "agent", approvalMode = "default", clearMemoryFirst } = req.body;

    if (!sessionId || !prompt) {
      return reply.status(400).send({ error: "sessionId and prompt are required" });
    }

    if (clearMemoryFirst) {
      await MemoryStore.eraseMemory(sessionId);
    }

    const history = await MemoryStore.getHistory(sessionId, 10);

    let synthesizedPrompt = "";
    if (systemInstruction) {
      synthesizedPrompt += `System Instructions:\n${systemInstruction}\n\n`;
    }

    if (history.length > 0) {
      synthesizedPrompt += "Conversation History:\n";
      for (const msg of history) {
        synthesizedPrompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
      }
      synthesizedPrompt += "\n";
    }

    synthesizedPrompt += `User: ${prompt}\nAssistant:`;

    const userMsg: ChatMessage = { role: "user", content: prompt, timestamp: Date.now() };
    await MemoryStore.appendMessage(sessionId, userMsg);

    try {
      const response = await axios.post<{ output: string; exitCode: number }>(
        `${BOB_RUNNER_URL}/run`,
        {
          prompt: synthesizedPrompt,
          mode,
          approvalMode,
        },
        { timeout: 180000 }
      );

      const assistantContent = response.data.output.trim();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
      };
      await MemoryStore.appendMessage(sessionId, assistantMsg);

      return reply.send({
        sessionId,
        response: assistantContent,
        exitCode: response.data.exitCode,
      });
    } catch (error: any) {
      req.log.error(error, "Failed to execute prompt in Bob Shell runner");
      return reply.status(502).send({
        error: "Failed to get response from Bob Shell runner",
        details: error.response?.data || error.message,
      });
    }
  });

  // Fallback to index.html for client-side routing
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith("/api")) {
      return reply.status(404).send({ error: "API endpoint not found" });
    }
    const indexPath = path.join(publicPath, "index.html");
    if (fs.existsSync(indexPath)) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: "Not found" });
  });

  return app;
}

async function main() {
  try {
    const server = await buildApp();
    await server.listen({ port: PORT, host: HOST });
    console.log(`Context & Memory Manager running on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
