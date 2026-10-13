import { describe, expect, it } from "vitest";
import {
  hasFullAgentAccess,
  isBasicAgentMode,
  isDyadProEnabled,
  type UserSettings,
} from "./schemas";

describe("full agent access", () => {
  const settings = (provider: string) =>
    ({
      selectedModel: { provider, name: "test" },
      selectedChatMode: "local-agent",
      enableDyadPro: false,
      providerSettings: {},
    }) as UserSettings;
  it.each(["lmstudio", "ollama"])(
    "%s has full agent access without daily quota or paid credentials",
    (provider) => {
      expect(hasFullAgentAccess(settings(provider))).toBe(true);
      expect(isBasicAgentMode(settings(provider))).toBe(false);
      expect(isDyadProEnabled(settings(provider))).toBe(false);
    },
  );
  it("does not enable hosted Pro for a cloud model without credentials", () => {
    expect(hasFullAgentAccess(settings("openai"))).toBe(false);
    expect(isBasicAgentMode(settings("openai"))).toBe(true);
  });
  it("uses an explicit per-chat model rather than the global model for UI access", () => {
    expect(
      hasFullAgentAccess(settings("openai"), {
        provider: "lmstudio",
        name: "qwen",
      }),
    ).toBe(true);
    expect(
      hasFullAgentAccess(settings("lmstudio"), {
        provider: "openai",
        name: "cloud",
      }),
    ).toBe(false);
  });
  it("preserves paid full-agent access for cloud models", () => {
    const paid = {
      ...settings("openai"),
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "paid-key" } } },
    };
    expect(hasFullAgentAccess(paid)).toBe(true);
    expect(isBasicAgentMode(paid)).toBe(false);
    expect(isDyadProEnabled(paid)).toBe(true);
  });
});
