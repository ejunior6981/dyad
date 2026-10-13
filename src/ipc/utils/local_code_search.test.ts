import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chunkCode,
  getLocalCodeSearchConfig,
  searchLocalCode,
  usesLocalCodeSearch,
} from "./local_code_search";
import type { UserSettings } from "@/lib/schemas";

describe("local semantic code search", () => {
  let directory: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  const config = { baseUrl: "http://127.0.0.1:11434", model: "bge-m3" };
  const files = [
    {
      path: "src/session.ts",
      content: "export function authenticate() { return user; }",
    },
    {
      path: "src/paint.ts",
      content: "export function paint() { return color; }",
    },
  ];
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-local-search-"));
    fetchMock = vi.fn(async (_url, options) => {
      const { input } = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          embeddings: input.map((text: string) =>
            /paint/.test(text) ? [0, 2] : [3, 0],
          ),
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DYAD_LOCAL_CODE_SEARCH", "true");
    vi.stubEnv("DYAD_LOCAL_EMBEDDING_URL", "");
    vi.stubEnv("DYAD_LOCAL_EMBEDDING_MODEL", "");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const settings = (provider: string) =>
    ({ selectedModel: { provider, name: "test" } }) as UserSettings;
  const search = (options = {}) =>
    searchLocalCode({
      query: "user login",
      files,
      appPath: path.join(directory, "app"),
      cacheRoot: path.join(directory, "cache"),
      config,
      ...options,
    });

  it("ranks semantic matches even without a literal query match", async () => {
    const results = await search();
    expect(results[0]).toMatchObject({
      path: "src/session.ts",
      startLine: 1,
      endLine: 1,
    });
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(
      fetchMock.mock.calls.every(
        ([url]) => url === `${config.baseUrl}/api/embed`,
      ),
    ).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).truncate).toBe(false);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });

  it("reuses embeddings and updates only changed files", async () => {
    await search();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await search();
    expect(fetchMock).toHaveBeenCalledTimes(4); // Query only.
    await search({
      files: [files[0], { ...files[1], content: "paint changed" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(6); // Query plus changed file.
  });

  it("never returns deleted files and isolates projects and embedding models", async () => {
    await search();
    const results = await search({ files: [files[1]] });
    expect(results.map((result) => result.path)).toEqual(["src/paint.ts"]);
    fetchMock.mockClear();
    await search({ appPath: path.join(directory, "different-app") });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear();
    await search({ config: { ...config, model: "another-model" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rebuilds corrupt caches", async () => {
    await search();
    const cacheRoot = path.join(directory, "cache");
    const [project] = await fs.readdir(cacheRoot);
    const entries = await fs.readdir(path.join(cacheRoot, project));
    for (const entry of entries)
      await fs.writeFile(path.join(cacheRoot, project, entry), "broken");
    fetchMock.mockClear();
    await search();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache or embed environment files", async () => {
    const results = await search({
      files: [{ path: ".env.production", content: "SECRET=private" }],
    });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rebuilds when cached dimensions no longer match the model", async () => {
    await search();
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: true,
      json: async () => ({
        embeddings: JSON.parse(options.body).input.map(() => [1, 0, 0]),
      }),
    }));
    fetchMock.mockClear();
    await search();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails clearly when Ollama is unavailable without a hosted fallback", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(search()).rejects.toMatchObject({ kind: "precondition" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { embeddings: [] },
    { embeddings: [[0, 0]] },
    { embeddings: [[Number.NaN, 1]] },
  ])("rejects invalid embeddings: %j", async (data) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    await expect(search()).rejects.toMatchObject({ kind: "precondition" });
  });

  it("cancels before requests and during embedding generation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(search({ signal: controller.signal })).rejects.toMatchObject({
      kind: "user_cancelled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const running = new AbortController();
    fetchMock.mockImplementation(async () => {
      running.abort();
      throw new Error("aborted");
    });
    await expect(search({ signal: running.signal })).rejects.toMatchObject({
      kind: "user_cancelled",
    });
  });

  it("chunks LF and CRLF identically with accurate line numbers", () => {
    const content = Array.from(
      { length: 150 },
      (_, i) => `const value${i} = ${i};`,
    ).join("\n");
    const chunks = chunkCode(content);
    expect(chunkCode(content.replaceAll("\n", "\r\n"))).toEqual(chunks);
    expect(chunks.at(-1)?.endLine).toBe(150);
    expect(chunks.every((chunk) => chunk.text.length <= 3_000)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(`${content}\n`);
    expect(
      chunkCode("x".repeat(9_000)).every((chunk) => chunk.text.length <= 3_000),
    ).toBe(true);
  });

  it("rejects oversized indexes and blank queries before requesting embeddings", async () => {
    await expect(search({ query: " " })).rejects.toMatchObject({
      kind: "validation",
    });
    await expect(
      search({
        files: [{ path: "large.ts", content: "x".repeat(3_000 * 4_001) }],
      }),
    ).rejects.toMatchObject({ kind: "precondition" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enables local search for local models without claiming a paid subscription", () => {
    expect(usesLocalCodeSearch(settings("lmstudio"))).toBe(true);
    expect(usesLocalCodeSearch(settings("ollama"))).toBe(true);
    expect(usesLocalCodeSearch(settings("openai"))).toBe(false);
    vi.stubEnv("DYAD_LOCAL_CODE_SEARCH", "false");
    expect(usesLocalCodeSearch(settings("lmstudio"))).toBe(false);
  });

  it("restricts embedding requests to loopback and supports model configuration", () => {
    expect(getLocalCodeSearchConfig()).toEqual(config);
    vi.stubEnv("DYAD_LOCAL_EMBEDDING_MODEL", "nomic-embed-text");
    expect(getLocalCodeSearchConfig().model).toBe("nomic-embed-text");
    for (const url of [
      "https://example.com",
      "file:///tmp",
      "http://localhost/api",
      "http://user:pass@localhost",
      "bad-url",
    ]) {
      vi.stubEnv("DYAD_LOCAL_EMBEDDING_URL", url);
      expect(() => getLocalCodeSearchConfig()).toThrow();
    }
  });
});
