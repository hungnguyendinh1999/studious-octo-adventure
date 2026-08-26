import { promises as fs } from "fs";
import path from "path";
import os from "os";
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import type { AddressInfo } from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const CLI_PATH = path.join(PROJECT_ROOT, "src", "cli.ts");

export interface WorkItemFixture {
  id: string;
  title: string;
  content: string;
  version?: number;
}

/**
 * A throwaway sandbox with the same artifacts/audit/context/skills layout
 * cli.ts expects relative to process.cwd() — isolates each test run from
 * the real project's audit/log.jsonl and artifacts/.
 */
export async function withTempProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-sdlc-phase1-test-"));
  await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(dir, "audit"), { recursive: true });
  await fs.mkdir(path.join(dir, "context"), { recursive: true });
  await fs.mkdir(path.join(dir, "skills"), { recursive: true });

  // Placeholders for the skill files baAgent.ts / contextLakeAgent.ts read
  // unconditionally (no missing-file fallback) — fixture data for this
  // sandbox only, never the real skills/*.md.
  await fs.writeFile(
    path.join(dir, "skills", "update-context-lake.md"),
    "Test fixture skill. Decide whether the approved content has durable knowledge worth keeping."
  );
  await fs.writeFile(
    path.join(dir, "skills", "draft-requirements.md"),
    "Test fixture skill. Draft a requirements document from the input."
  );

  return dir;
}

export async function seedInReviewWorkItem(
  dir: string,
  { id, title, content, version = 1 }: WorkItemFixture
): Promise<void> {
  const workItemDir = path.join(dir, "artifacts", id);
  await fs.mkdir(workItemDir, { recursive: true });

  const workItem = {
    id,
    title,
    rawRequest: `--- fixture.md ---\n${content}`,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(workItemDir, "work-item.json"),
    JSON.stringify(workItem, null, 2)
  );

  const artifact = {
    workItemId: id,
    version,
    content,
    status: "in_review",
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(workItemDir, `requirements.v${version}.md`), content);
  await fs.writeFile(
    path.join(workItemDir, `requirements.v${version}.meta.json`),
    JSON.stringify({ ...artifact, content: "(see .md file)" }, null, 2)
  );
  await fs.writeFile(
    path.join(workItemDir, "requirements.latest.json"),
    JSON.stringify(artifact, null, 2)
  );
}

export interface StubOllama {
  url: string;
  close: () => Promise<void>;
}

/**
 * Minimal stand-in for Ollama's OpenAI-compatible /v1/chat/completions
 * endpoint. Always answers NO_NEW_KNOWLEDGE, the sentinel
 * contextLakeAgent.ts treats as "nothing to add" — keeps every CLI run
 * fully offline and deterministic.
 */
export function startStubOllama(): Promise<StubOllama> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "stub-completion",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "NO_NEW_KNOWLEDGE" },
                finish_reason: "stop",
              },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns the real CLI entrypoint (absolute paths to the local tsx binary
 * and src/cli.ts) with cwd pinned to an isolated sandbox, so cli.ts's
 * process.cwd()-relative data paths resolve into the sandbox while normal
 * Node module resolution (commander, openai, etc.) still finds
 * node_modules via the script's real location.
 */
export function runCli(
  cliArgs: string[],
  opts: { cwd: string; ollamaBaseUrl?: string }
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_PATH, ...cliArgs], {
      cwd: opts.cwd,
      env: opts.ollamaBaseUrl
        ? {
            ...process.env,
            OLLAMA_MODEL: "test-model",
            OLLAMA_BASE_URL: opts.ollamaBaseUrl,
          }
        : process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export async function readAuditLines(dir: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(path.join(dir, "audit", "log.jsonl"), "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
