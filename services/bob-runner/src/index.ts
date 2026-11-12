import crypto from "crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ALLOWED_MODES, BobMode, executeBobPrompt } from "./executor";

const app = Fastify({ logger: true });

const PORT = parseInt(process.env.PORT || "8081", 10);
const HOST = process.env.HOST || "0.0.0.0";
const API_TOKEN = process.env.API_TOKEN || "";
const MAX_CONCURRENT_RUNS = parseInt(process.env.MAX_CONCURRENT_RUNS || "2", 10);
const DEFAULT_TIMEOUT_SECONDS = parseInt(process.env.DEFAULT_TIMEOUT_SECONDS || "180", 10);
const MAX_TIMEOUT_SECONDS = parseInt(process.env.MAX_TIMEOUT_SECONDS || "600", 10);
const MAX_PROMPT_CHARS = parseInt(process.env.MAX_PROMPT_CHARS || "20000", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";

if (!API_TOKEN) {
  app.log.warn("API_TOKEN is not set — /run is UNAUTHENTICATED");
}
if (CORS_ORIGIN) {
  app.register(cors, { origin: CORS_ORIGIN.split(",") });
}

function tokenOk(header: string | undefined): boolean {
  const provided = Buffer.from((header || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(API_TOKEN);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

app.addHook("onRequest", async (req, reply) => {
  if (!API_TOKEN || req.url === "/healthz") return;
  if (!tokenOk(req.headers.authorization)) {
    return reply.status(401).send({ error: "unauthorized" });
  }
});

app.get("/healthz", async () => ({ status: "ok" }));

let activeRuns = 0;

app.post<{
  Body: {
    prompt: string;
    mode?: BobMode;
    timeoutSeconds?: number;
    approvalMode?: string; // accepted for context-manager compatibility; ignored (runner always uses --trust)
  };
}>(
  "/run",
  {
    schema: {
      body: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: MAX_PROMPT_CHARS },
          mode: { type: "string", enum: [...ALLOWED_MODES] },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_SECONDS },
          approvalMode: { type: "string" },
        },
      },
    },
  },
  async (req, reply) => {
    const { prompt, mode, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS } = req.body;

    if (activeRuns >= MAX_CONCURRENT_RUNS) {
      return reply
        .status(429)
        .header("Retry-After", "10")
        .send({ error: "runner busy", maxConcurrentRuns: MAX_CONCURRENT_RUNS });
    }

    activeRuns++;
    try {
      const result = await executeBobPrompt({ prompt, mode, timeoutMs: timeoutSeconds * 1000 });
      req.log.info(
        { mode, promptChars: prompt.length, status: result.status, durationMs: result.durationMs },
        "bob run finished"
      );
      return reply.status(result.status === "timeout" ? 504 : 200).send(result);
    } catch (error: any) {
      req.log.error(error, "Execution error");
      return reply.status(500).send({ error: "Execution failed", message: error.message });
    } finally {
      activeRuns--;
    }
  }
);

async function main() {
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
