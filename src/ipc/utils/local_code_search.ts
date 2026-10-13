// Custom fork: local semantic retrieval without a Dyad Engine subscription.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";

export interface LocalCodeSearchConfig {
  baseUrl: string;
  model: string;
}

export function usesLocalCodeSearch(settings: UserSettings): boolean {
  return (
    process.env.DYAD_LOCAL_CODE_SEARCH !== "false" &&
    ["lmstudio", "ollama"].includes(settings.selectedModel?.provider)
  );
}

export function getLocalCodeSearchConfig(): LocalCodeSearchConfig {
  const baseUrl =
    process.env.DYAD_LOCAL_EMBEDDING_URL || "http://127.0.0.1:11434";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new DyadError(
      "Invalid local embedding URL.",
      DyadErrorKind.Validation,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new DyadError(
      "Local code search requires an Ollama URL on localhost with no path or credentials.",
      DyadErrorKind.Validation,
    );
  }
  return {
    baseUrl: url.origin,
    model: process.env.DYAD_LOCAL_EMBEDDING_MODEL || "bge-m3",
  };
}

interface CodeFile {
  path: string;
  content: string;
}
interface Chunk {
  startLine: number;
  endLine: number;
  text: string;
}
export interface LocalCodeSearchResult extends Chunk {
  path: string;
  score: number;
}

const CHUNK_CHARACTERS = 3_000;
const MAX_CHUNKS = 4_000;
const BATCH_SIZE = 8;
const MAX_RESULTS = 8;
const vectorSchema = z.array(z.number().finite()).min(1).max(8_192);
const cacheSchema = z.object({
  hash: z.string(),
  vectors: z.array(vectorSchema).max(MAX_CHUNKS),
});

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Bound chunks by characters, including minified files with very long lines.
export function chunkCode(content: string): Chunk[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const chunks: Chunk[] = [];
  let text = "";
  let startLine = 1;
  let endLine = 1;
  const flush = () => {
    if (text.trim()) chunks.push({ text, startLine, endLine });
    text = "";
  };
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (text.length + line.length + 1 > CHUNK_CHARACTERS) flush();
    if (!text) startLine = lineNumber;
    endLine = lineNumber;
    if (line.length > CHUNK_CHARACTERS) {
      for (let offset = 0; offset < line.length; offset += CHUNK_CHARACTERS) {
        text = line.slice(offset, offset + CHUNK_CHARACTERS);
        flush();
      }
    } else {
      text += `${line}\n`;
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new DyadError(
        "This project exceeds the local search limit of 4,000 code chunks.",
        DyadErrorKind.Precondition,
      );
    }
  }
  flush();
  return chunks;
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DyadError("Code search cancelled.", DyadErrorKind.UserCancelled);
  }
}

async function embed(
  input: string[],
  config: LocalCodeSearchConfig,
  signal?: AbortSignal,
): Promise<number[][]> {
  checkCancellation(signal);
  const timeout = AbortSignal.timeout(120_000);
  try {
    const response = await fetch(`${config.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input, truncate: false }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
    if (!response.ok) {
      // Do not log or echo the server body; it can contain project code.
      throw new DyadError(
        `Local embeddings failed (HTTP ${response.status}). Start Ollama and install ${config.model}.`,
        DyadErrorKind.Precondition,
      );
    }
    const data = z
      .object({ embeddings: z.array(vectorSchema) })
      .parse(await response.json());
    if (data.embeddings.length !== input.length) {
      throw new Error("Unexpected embedding count");
    }
    const dimensions = data.embeddings[0]?.length;
    return data.embeddings.map((vector) => {
      const norm = Math.hypot(...vector);
      if (
        vector.length !== dimensions ||
        norm === 0 ||
        !Number.isFinite(norm)
      ) {
        throw new Error("Invalid embedding dimensions or norm");
      }
      return vector.map((value) => value / norm);
    });
  } catch (error) {
    checkCancellation(signal);
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      timeout.aborted
        ? "Local embedding request timed out. Check that Ollama is running."
        : "Unable to generate local embeddings. Check Ollama and its embedding model.",
      DyadErrorKind.Precondition,
      { cause: error },
    );
  }
}

async function readCache(
  cachePath: string,
  contentHash: string,
  count: number,
  dimensions: number,
): Promise<number[][] | undefined> {
  try {
    if ((await fs.stat(cachePath)).size > 32_000_000) return undefined;
    const cached = cacheSchema.parse(
      JSON.parse(await fs.readFile(cachePath, "utf8")),
    );
    if (
      cached.hash === contentHash &&
      cached.vectors.length === count &&
      cached.vectors.every(
        (vector) =>
          vector.length === dimensions &&
          Math.abs(Math.hypot(...vector) - 1) < 0.001,
      )
    ) {
      return cached.vectors;
    }
  } catch {
    // Missing or corrupt caches are disposable; rebuild from current files.
  }
  return undefined;
}

async function writeCache(
  cachePath: string,
  contentHash: string,
  vectors: number[][],
): Promise<void> {
  const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      JSON.stringify({ hash: contentHash, vectors }),
      { mode: 0o600 },
    );
    await fs.rename(temporaryPath, cachePath);
  } catch {
    // Search still works when the optional cache cannot be written.
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function searchLocalCode({
  query,
  files,
  appPath,
  cacheRoot,
  config,
  signal,
}: {
  query: string;
  files: CodeFile[];
  appPath: string;
  cacheRoot: string;
  config: LocalCodeSearchConfig;
  signal?: AbortSignal;
}): Promise<LocalCodeSearchResult[]> {
  if (!query.trim()) {
    throw new DyadError(
      "Search query cannot be empty.",
      DyadErrorKind.Validation,
    );
  }
  checkCancellation(signal);
  const projectFiles = files.filter(
    (file) => !path.basename(file.path).startsWith(".env"),
  );
  // Enforce the cap before generating embeddings or writing the cache.
  let totalChunks = 0;
  for (const file of projectFiles) {
    totalChunks += chunkCode(file.content).length;
    if (totalChunks > MAX_CHUNKS) {
      throw new DyadError(
        "This project exceeds the local search limit of 4,000 code chunks.",
        DyadErrorKind.Precondition,
      );
    }
    await yieldToEventLoop();
    checkCancellation(signal);
  }
  if (totalChunks === 0) return [];
  const [queryVector] = await embed([query], config, signal);
  const cacheDirectory = path.join(
    cacheRoot,
    hash(`${path.resolve(appPath)}\n${config.baseUrl}\n${config.model}\nv1`),
  );
  await fs.mkdir(cacheDirectory, { recursive: true }).catch(() => undefined);
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []),
  ];
  const best: LocalCodeSearchResult[] = [];
  for (const file of projectFiles) {
    checkCancellation(signal);
    const chunks = chunkCode(file.content);
    if (!chunks.length) continue;
    const cachePath = path.join(cacheDirectory, `${hash(file.path)}.json`);
    const contentHash = hash(file.content);
    let vectors = await readCache(
      cachePath,
      contentHash,
      chunks.length,
      queryVector.length,
    );
    if (!vectors) {
      vectors = [];
      for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
        const batch = await embed(
          chunks
            .slice(offset, offset + BATCH_SIZE)
            .map((chunk) => `${file.path}\n${chunk.text}`),
          config,
          signal,
        );
        if (batch.some((vector) => vector.length !== queryVector.length)) {
          throw new DyadError(
            "The embedding model changed during search. Retry with a stable model.",
            DyadErrorKind.Precondition,
          );
        }
        vectors.push(...batch);
      }
      checkCancellation(signal);
      await writeCache(cachePath, contentHash, vectors);
    }
    for (const [index, chunk] of chunks.entries()) {
      const similarity = queryVector.reduce(
        (sum, value, dimension) => sum + value * vectors[index][dimension],
        0,
      );
      const text = `${file.path}\n${chunk.text}`.toLowerCase();
      const lexical = terms.length
        ? terms.filter((term) => text.includes(term)).length / terms.length
        : 0;
      best.push({
        ...chunk,
        path: file.path,
        score: 0.8 * similarity + 0.2 * lexical,
      });
      best.sort(
        (a, b) =>
          b.score - a.score ||
          a.path.localeCompare(b.path) ||
          a.startLine - b.startLine,
      );
      best.length = Math.min(best.length, MAX_RESULTS);
      if (index % 32 === 0) {
        await yieldToEventLoop();
        checkCancellation(signal);
      }
    }
    await yieldToEventLoop();
  }
  checkCancellation(signal);
  return best;
}
