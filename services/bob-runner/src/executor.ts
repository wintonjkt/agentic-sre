import { spawn } from "child_process";

export interface BobRunResult {
  output: string;
  exitCode: number;
}

export interface BobRunOptions {
  prompt: string;
  approvalMode?: "default" | "yolo";
  mode?: "agent" | "code" | "ask" | "plan" | "advanced" | "instana" | "openshift-sre" | "infra-sre";
  cwd?: string;
  timeoutMs?: number;
}

export function executeBobPrompt(options: BobRunOptions): Promise<BobRunResult> {
  return new Promise((resolve, reject) => {
    const {
      prompt,
      mode = "agent",
      cwd = process.env.BOB_WORKSPACE || "/tmp/bob-workspace",
      timeoutMs = 180000,
    } = options;

    const apiKey = process.env.BOBSHELL_API_KEY;

    const args: string[] = [
      "run",
      prompt,
      "--mode",
      mode,
      "--trust",
      "--format",
      "json",
      "--max-turns",
      "20",
      ...(apiKey ? ["--auth-method", "api-key"] : []),
    ];
    const gatewayUrl = process.env.BOB_GATEWAY_URL;
    const bobBin = process.env.BOB_BIN_PATH || "bob";

    const child = spawn(bobBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BOBSHELL_API_KEY: apiKey,
        ...(gatewayUrl ? { BOB_GATEWAY_URL: gatewayUrl } : {}),
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        HOME: "/bob-home",
        CI: "true",
      },
    });

    let stdoutData = "";
    let stderrData = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Bob process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 0;
      const combinedOutput = (stdoutData || stderrData).trim();
      resolve({
        output: combinedOutput || `Executed with exit code ${exitCode}`,
        exitCode,
      });
    });
  });
}
