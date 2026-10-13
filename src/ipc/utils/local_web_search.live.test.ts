// @vitest-environment node
import { expect, it } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { searchLocalWeb } from "./local_web_search";

it.runIf(process.env.DYAD_LOCAL_WEB_SEARCH_SMOKE === "true")(
  "returns real sources through local SearXNG",
  async () => {
    const result = await searchLocalWeb("React documentation", {
      selectedModel: { provider: "lmstudio", name: "qwen" },
    } as UserSettings);
    expect(result).toContain("https://react.dev/");
  },
  35_000,
);
