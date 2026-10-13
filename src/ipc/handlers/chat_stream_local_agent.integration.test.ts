// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { chats, messages } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { setModelClientFetchForTesting } from "@/ipc/utils/get_model_client";
import {
  startReview,
  waitForSubagents,
} from "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map(), credits: vi.fn() };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock("@/ipc/services/codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: h.credits,
}));

let harness: ChatFlowHarness;
const requests: Array<{ url: string; model: string }> = [];
let delayReview = false;
beforeAll(async () => {
  harness = await setupChatFlowHarness({
    electronMock: h,
    chatMode: "local-agent",
    settings: {
      enableDyadPro: false,
      enableExplorerSubagent: true,
      enableAdvancedSubagents: true,
    },
  });
  vi.stubEnv("LM_STUDIO_BASE_URL_FOR_TESTING", harness.fakeLlmUrl);
  vi.stubEnv("DYAD_SIMULATE_FREE_AGENT_QUOTA_EXCEEDED", "true");
  await harness.db
    .update(chats)
    .set({
      chatMode: "local-agent",
      modelSelection: {
        provider: "lmstudio",
        name: "qwen3.5-9b",
        effortLevel: "medium",
      },
    })
    .where(eq(chats.id, harness.chatId));
  setModelClientFetchForTesting(async (url, init) => {
    requests.push({
      url: String(url),
      model: JSON.parse(String(init?.body)).model,
    });
    if (delayReview) await new Promise((resolve) => setTimeout(resolve, 600));
    return fetch(url, init);
  });
}, 60_000);
beforeEach(async () => {
  h.credits.mockClear();
  requests.length = 0;
  delayReview = false;
  await harness.db.delete(messages);
});
afterAll(async () => {
  setModelClientFetchForTesting(undefined);
  vi.unstubAllEnvs();
  await harness?.dispose();
});

it.each([false, true])(
  "local Agent runs despite exhausted quota and old Pro enabled=%s",
  async (enableDyadPro) => {
    writeSettings({
      enableDyadPro,
      providerSettings: { auto: { apiKey: { value: "old-pro-key" } } },
      proModelUsage: "pro",
    });
    const result = await harness.streamChat("[dump]");
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(
      result.messages.some(
        (message) => message.role === "assistant" && Boolean(message.content),
      ),
    ).toBe(true);
    expect(
      result.messages.every((message) => !message.usingFreeAgentModeQuota),
    ).toBe(true);
    expect(h.credits).not.toHaveBeenCalled();
    const dump = result.getServerDump({ type: "request", maskModel: false });
    expect(dump.parsed.body.model).toBe("qwen3.5-9b");
    const tools = dump.parsed.body.tools.map(
      (tool: { function: { name: string } }) => tool.function.name,
    );
    expect(tools).toContain("spawn_agent");
    expect(tools).toContain("list_agents");
    expect(tools).not.toContain("web_search");
    expect(tools).not.toContain("generate_image");
  },
  30_000,
);

it("runs the local Reviewer through its entitlement watcher without hosted inference", async () => {
  writeSettings({ enableDyadPro: false, proModelUsage: "pro" });
  const result = await harness.streamChat("tc=local-agent/dyad-write-angle");
  expect(result.eventsFor("chat:response:error")).toHaveLength(0);
  const source = result.messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant")!;
  expect(source.commitHash).toBeTruthy();
  requests.length = 0;
  delayReview = true;
  const review = await startReview({
    chatId: harness.chatId,
    sourceMessageId: source.id,
    invocationSource: "review_button",
  });
  const [finished] = await waitForSubagents(
    harness.chatId,
    [review.id],
    undefined,
    30_000,
  );
  expect(["completed", "partial"]).toContain(finished.status);
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (request) =>
        request.model === "qwen3.5-9b" &&
        request.url.startsWith(harness.fakeLlmUrl),
    ),
  ).toBe(true);
  expect(h.credits).not.toHaveBeenCalled();
}, 30_000);
