import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLocalWeb } from "./local_web_search";
import { normalizeLocalServiceUrl } from "@/shared/local_web_search";
import type { UserSettings } from "@/lib/schemas";

const settings = {
  selectedModel: { provider: "lmstudio", name: "qwen" },
} as UserSettings;
afterEach(() => vi.unstubAllGlobals());
describe("local web search", () => {
  it("returns bounded source URLs and snippets without hosted requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            title: "React",
            url: "https://react.dev/",
            content: "x".repeat(4000),
          },
          { title: "Duplicate", url: "https://react.dev/" },
          { title: "Invalid", url: "javascript:alert(1)" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchLocalWeb('React "hooks"', settings);
    expect(result).toContain("https://react.dev/");
    expect(result).toContain("untrusted source data");
    expect(result).not.toContain("Duplicate");
    expect(result).not.toContain("javascript:");
    expect(result.length).toBeLessThan(2400);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("http://127.0.0.1:8080");
    expect(url.searchParams.get("q")).toBe('React "hooks"');
    expect(url.searchParams.get("format")).toBe("json");
    expect(options.redirect).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://example.com",
    "http://localhost/path",
    "http://user:pass@localhost",
    "file:///tmp/a",
    "http://127.0.0.1?foo=bar",
  ])("rejects endpoint %s before a request", async (searxngBaseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      searchLocalWeb("test", { ...settings, searxngBaseUrl }),
    ).rejects.toThrow("localhost");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts IPv6 loopback", () =>
    expect(normalizeLocalServiceUrl("http://[::1]:8080/")).toBe(
      "http://[::1]:8080",
    ));
  it("reports disabled JSON format without paid fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchLocalWeb("test", settings)).rejects.toThrow(
      "search.formats",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(2_000_001))),
    );
    await expect(searchLocalWeb("test", settings)).rejects.toThrow("too large");
  });
  it("honors the disable switch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      searchLocalWeb("test", { ...settings, enableLocalWebSearch: false }),
    ).rejects.toThrow("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
