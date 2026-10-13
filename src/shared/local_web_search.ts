export const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8080";

export function normalizeLocalServiceUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Use a localhost HTTP URL with no path or credentials.");
  }
  return url.origin;
}
