// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
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
  writeSettings({ comfyuiWorkflow: "" });
  await harness.db
    .update(chats)
    .set({ chatMode: "local-agent" })
    .where(eq(chats.id, harness.chatId));
});
afterAll(async () => {
  setModelClientFetchForTesting(undefined);
  vi.unstubAllEnvs();
  await harness?.dispose();
});

it.each([
  [false, "local-agent"],
  [true, "local-agent"],
  [false, "build"],
  [true, "build"],
] as const)(
  "local full Agent runs with old Pro enabled=%s and saved mode=%s",
  async (enableDyadPro, chatMode) => {
    await harness.db
      .update(chats)
      .set({ chatMode })
      .where(eq(chats.id, harness.chatId));
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
    expect(tools).toContain("web_search");
    expect(tools).not.toContain("generate_image");
  },
  30_000,
);

it("executes search and image tools against local HTTP services in a real Agent turn", async () => {
  const serviceRequests: string[] = [];
  let queuedWorkflow:
    | Record<string, { inputs: Record<string, unknown> }>
    | undefined;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=",
    "base64",
  );
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    serviceRequests.push(url.pathname);
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/search") {
      res.end(
        JSON.stringify({
          results: [
            {
              title: "React",
              url: "https://react.dev/",
              content: "Official React documentation",
            },
          ],
        }),
      );
    } else if (url.pathname === "/prompt") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      queuedWorkflow = JSON.parse(Buffer.concat(chunks).toString()).prompt;
      res.end(JSON.stringify({ prompt_id: "local-job" }));
    } else if (url.pathname === "/history/local-job") {
      res.end(
        JSON.stringify({
          "local-job": {
            status: { completed: true },
            outputs: {
              "2": {
                images: [
                  { filename: "image.png", subfolder: "", type: "output" },
                ],
              },
            },
          },
        }),
      );
    } else if (url.pathname === "/view") {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    writeSettings({
      enableDyadPro: false,
      searxngBaseUrl: `http://127.0.0.1:${port}`,
      comfyuiBaseUrl: `http://127.0.0.1:${port}`,
      comfyuiWorkflow: JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
        "2": { class_type: "SaveImage", inputs: {} },
      }),
      agentToolConsents: { web_search: "always", generate_image: "always" },
    });
    const result = await harness.streamChat("tc=local-agent/local-services");
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(serviceRequests).toEqual([
      "/search",
      "/prompt",
      "/history/local-job",
      "/view",
    ]);
    expect(queuedWorkflow?.["1"].inputs.text).toBe(
      'An illustration of a "tree"',
    );
    const content = result.messages
      .map((message) => message.content)
      .join("\n");
    expect(content).toContain("https://react.dev/");
    const mediaDir = path.join(harness.appDir, DYAD_MEDIA_DIR_NAME);
    const images = (await fs.readdir(mediaDir)).filter(
      (name) => name.startsWith("generated-") && name.endsWith(".png"),
    );
    expect(images).toHaveLength(1);
    expect(await fs.readFile(path.join(mediaDir, images[0]))).toEqual(png);
    expect(h.credits).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    writeSettings({
      searxngBaseUrl: "http://127.0.0.1:8080",
      comfyuiBaseUrl: "http://127.0.0.1:8188",
      comfyuiWorkflow: "",
    });
  }
}, 30_000);

it("runs the local Reviewer through its entitlement watcher without hosted inference", async () => {
  writeSettings({ enableDyadPro: false, proModelUsage: "pro" });
  await harness.db
    .update(chats)
    .set({ chatMode: "build" })
    .where(eq(chats.id, harness.chatId));
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
