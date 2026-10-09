import Fastify from "fastify";
import cors from "@fastify/cors";
import { executeBobPrompt } from "./executor";

const app = Fastify({ logger: true });

const PORT = parseInt(process.env.PORT || "8081", 10);
const HOST = process.env.HOST || "0.0.0.0";

app.register(cors, { origin: "*" });

app.get("/healthz", async () => ({ status: "ok" }));

app.post<{
  Body: {
    prompt: string;
    approvalMode?: "default" | "yolo";
    mode?: "code" | "ask" | "plan" | "advanced";
  };
}>("/run", async (req, reply) => {
  const { prompt, approvalMode, mode } = req.body;

  if (!prompt) {
    return reply.status(400).send({ error: "prompt is required" });
  }

  try {
    const result = await executeBobPrompt({
      prompt,
      approvalMode,
      mode,
    });
    return reply.send(result);
  } catch (error: any) {
    req.log.error(error, "Execution error");
    return reply.status(500).send({
      error: "Execution failed",
      message: error.message,
    });
  }
});

async function main() {
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Bob Shell Runner service running on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
