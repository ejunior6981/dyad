import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { queryKeys } from "@/lib/queryKeys";
const mocks = vi.hoisted(() => ({ quota: vi.fn() }));
vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: {
      selectedModel: { provider: "openai", name: "cloud" },
      enableDyadPro: false,
    },
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { freeAgentQuota: { getFreeAgentQuotaStatus: mocks.quota } },
}));
afterEach(() => vi.clearAllMocks());

it("ignores an exhausted cached quota for a local chat and restores it for cloud chats", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const exhausted = {
    messagesUsed: 5,
    messagesLimit: 5,
    isQuotaExceeded: true,
    resetTime: Date.now() + 3600000,
    hoursUntilReset: 1,
  };
  client.setQueryData(queryKeys.freeAgentQuota.status, exhausted);
  mocks.quota.mockResolvedValue(exhausted);
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  const { result, rerender, unmount } = renderHook(
    ({ provider }) => useFreeAgentQuota({ provider, name: "model" }),
    { wrapper: Wrapper, initialProps: { provider: "lmstudio" } },
  );
  try {
    expect(result.current.isUnlimited).toBe(true);
    expect(result.current.isQuotaExceeded).toBe(false);
    expect(result.current.quotaStatus).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mocks.quota).not.toHaveBeenCalled();
    rerender({ provider: "openai" });
    await waitFor(() => expect(result.current.isQuotaExceeded).toBe(true));
    expect(result.current.isUnlimited).toBe(false);
    rerender({ provider: "ollama" });
    expect(result.current.isQuotaExceeded).toBe(false);
  } finally {
    unmount();
    client.clear();
  }
});
