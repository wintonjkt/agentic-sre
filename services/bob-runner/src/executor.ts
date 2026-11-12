import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const ALLOWED_MODES = [
  "agent",
  "code",
  "ask",
  "plan",
  "advanced",
  "instana",
  "openshift-sre",
  "infra-sre",
] as const;
export type BobMode = (typeof ALLOWED_MODES)[number];

export interface BobRunResult {
  status: "success" | "failed" | "timeout";
  result: unknown;
  /** True when stdout was not valid JSON and `result` is the raw text. */
  rawOutput: boolean;
  /** Raw stdout/stderr text (kept for context-manager compatibility). */
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface BobRunOptions {
  prompt: string;
  mode?: BobMode;
  timeoutMs?: number;
}

const KILL_GRACE_MS = 5000;

/** Pull the final assistant message out of `bob run --format json` output. */
function extractResult(parsed: any): unknown {
  if (parsed && typeof parsed === "object") {
    for (const key of ["last_message", "result", "response", "output"]) {
      if (parsed[key] !== undefined) return parsed[key];
    }
  }
  return parsed;
}

export async function executeBobPrompt(options: BobRunOptions): Promise<BobRunResult> {
  const { prompt, mode = "agent", timeoutMs = 180000 } = options;

  const baseDir = process.env.BOB_WORKSPACE || path.join(os.tmpdir(), "bob-workspace");
  await fs.mkdir(baseDir, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(baseDir, "run-"));

  const args = ["run", "--mode", mode, "--trust", "--format", "json", "--max-turns", "20", prompt];
  const bobBin = process.env.BOB_BIN_PATH || "bob";
  const gatewayUrl = process.env.BOB_GATEWAY_URL;
  const started = Date.now();

  try {
    return await new Promise<BobRunResult>((resolve, reject) => {
      const child = spawn(bobBin, args, {
        cwd: workDir,
        detached: true, // own process group so tool subprocesses can be killed too
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(gatewayUrl ? { BOB_GATEWAY_URL: gatewayUrl } : {}),
          ...(process.env.BOB_TLS_REJECT_UNAUTHORIZED
            ? { NODE_TLS_REJECT_UNAUTHORIZED: process.env.BOB_TLS_REJECT_UNAUTHORIZED }
            : {}),
          HOME: process.env.HOME || "/bob-home",
          CI: "true",
        },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const killGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          /* already gone */
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        killGroup("SIGKILL"); // reap any leftover children
        const exitCode = code ?? (timedOut ? 124 : 1);
        const output = (stdout || stderr).trim();
        let result: unknown = output;
        let rawOutput = true;
        try {
          result = extractResult(JSON.parse(stdout));
          rawOutput = false;
        } catch {
          /* leave raw text */
        }
        resolve({
          status: timedOut ? "timeout" : exitCode === 0 ? "success" : "failed",
          result,
          rawOutput,
          output: output || `Executed with exit code ${exitCode}`,
          exitCode,
          durationMs: Date.now() - started,
        });
      });
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
