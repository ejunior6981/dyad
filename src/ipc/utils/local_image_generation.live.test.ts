// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { generateLocalImage } from "./local_image_generation";

it.runIf(process.env.DYAD_LOCAL_IMAGE_SMOKE === "true")(
  "renders an image through the real local ComfyUI server",
  async () => {
    const comfyuiWorkflow = await fs.readFile(
      path.resolve("local-services/comfyui/workflow.sd15.json"),
      "utf8",
    );
    const result = await generateLocalImage(
      "A cozy wooden cabin beside a mountain lake, pine trees, warm sunrise, detailed landscape illustration",
      {
        selectedModel: { provider: "lmstudio", name: "qwen/qwen3.5-9b" },
        comfyuiWorkflow,
      } as UserSettings,
    );
    const png = Buffer.from(result.b64_json, "base64");
    expect(png.byteLength).toBeGreaterThan(1000);
    const output = path.resolve(
      "local-services/comfyui/.runtime/smoke-output.png",
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, png);
  },
  300_000,
);
