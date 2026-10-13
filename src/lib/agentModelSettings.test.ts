import { describe, expect, it } from "vitest";
import { getAgentModelSettings } from "./agentModelSettings";
import {
  hasFullAgentAccess,
  isDyadProEnabled,
  type UserSettings,
} from "./schemas";

describe("local agent inference", () => {
  const hosted = {
    provider: "openai",
    name: "hosted-helper",
    effortLevel: "medium",
  };
  it.each(["lmstudio", "ollama"])(
    "keeps %s subagents on the root model without hosted billing",
    (provider) => {
      const settings = {
        enableDyadPro: true,
        proModelUsage: "pro",
        providerSettings: { auto: { apiKey: { value: "old-pro-key" } } },
        selectedModel: {
          provider,
          name: "qwen3.5-9b",
          connection: "pro",
          effortLevel: "medium",
        },
      } as unknown as UserSettings;
      const child = getAgentModelSettings(settings, hosted);
      expect(child.selectedModel).toMatchObject({
        provider,
        name: "qwen3.5-9b",
        connection: "api-key",
      });
      expect(child.enableDyadPro).toBe(false);
      expect(hasFullAgentAccess(child)).toBe(true);
      expect(isDyadProEnabled(child)).toBe(false);
      expect(settings.enableDyadPro).toBe(true);
    },
  );
  it("preserves hosted helper selection for paid cloud sessions", () => {
    const settings = {
      enableDyadPro: true,
      selectedModel: { provider: "anthropic", name: "cloud" },
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
    } as unknown as UserSettings;
    const child = getAgentModelSettings(settings, hosted);
    expect(child.selectedModel).toEqual(hosted);
    expect(isDyadProEnabled(child)).toBe(true);
  });
});
