import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { generateLocalImage } from "./local_image_generation";
import { parseLocalImageWorkflow } from "@/shared/local_image_generation";

const workflow = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "{{prompt}}", seed: "{{seed}}" },
  },
  "2": { class_type: "SaveImage", inputs: { filename_prefix: "Dyad" } },
};
const settings = {
  selectedModel: { provider: "lmstudio", name: "qwen" },
  comfyuiWorkflow: JSON.stringify(workflow),
} as UserSettings;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
afterEach(() => vi.unstubAllGlobals());
describe("local image generation", () => {
  it("queues a workflow, substitutes prompt safely, and downloads only its PNG", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ prompt_id: "job1" }))
      .mockResolvedValueOnce(
        Response.json({
          job1: {
            status: { completed: true },
            outputs: {
              "2": {
                images: [
                  { filename: "local.png", subfolder: "", type: "output" },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(new Response(png));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateLocalImage('A "quoted" tree', settings);
    expect(Buffer.from(result.b64_json, "base64")).toEqual(png);
    const queued = JSON.parse(fetchMock.mock.calls[0][1].body).prompt;
    expect(queued["1"].inputs.text).toBe('A "quoted" tree');
    expect(typeof queued["1"].inputs.seed).toBe("number");
    expect(workflow["1"].inputs.text).toBe("{{prompt}}");
    expect(
      fetchMock.mock.calls.every(([url]) =>
        url.startsWith("http://127.0.0.1:8188/"),
      ),
    ).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toContain("/view?filename=local.png");
  });
  it("rejects hosted/custom workflow nodes before submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bad = {
      ...workflow,
      "3": { class_type: "OpenAIImageGeneration", inputs: {} },
    };
    await expect(
      generateLocalImage("test", {
        ...settings,
        comfyuiWorkflow: JSON.stringify(bad),
      }),
    ).rejects.toThrow("Unsupported local node");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects missing placeholders and UI-format workflows", () => {
    expect(() =>
      parseLocalImageWorkflow(JSON.stringify({ "2": workflow["2"] })),
    ).toThrow("positive prompt");
    expect(() => parseLocalImageWorkflow('{"nodes":[]}')).toThrow();
  });
  it("reports workflow execution failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ prompt_id: "job1" }))
        .mockResolvedValueOnce(
          Response.json({ job1: { status: { status_str: "error" } } }),
        ),
    );
    await expect(generateLocalImage("test", settings)).rejects.toThrow(
      "could not execute",
    );
  });
  it("honors pre-cancelled requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn((_url, init) => {
      init.signal.throwIfAborted();
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      generateLocalImage("test", settings, controller.signal),
    ).rejects.toThrow();
  });
});
