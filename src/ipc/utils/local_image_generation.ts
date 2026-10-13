import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { UserSettings } from "@/lib/schemas";
import { isLocalModelSelection } from "@/lib/schemas";
import {
  DEFAULT_COMFYUI_URL,
  parseLocalImageWorkflow,
} from "@/shared/local_image_generation";
import { normalizeLocalServiceUrl } from "@/shared/local_web_search";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export function usesLocalImageGeneration(settings: UserSettings) {
  return isLocalModelSelection(settings.selectedModel);
}

async function readBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok)
    throw new DyadError(
      `ComfyUI request failed (HTTP ${response.status}). Check the server and workflow.`,
      DyadErrorKind.External,
    );
  if (!response.body)
    throw new DyadError("ComfyUI returned no data.", DyadErrorKind.External);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new DyadError(
          "ComfyUI response is too large.",
          DyadErrorKind.External,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function generateLocalImage(
  prompt: string,
  settings: UserSettings,
  abortSignal?: AbortSignal,
): Promise<{ b64_json: string }> {
  let baseUrl: string;
  let workflow: ReturnType<typeof parseLocalImageWorkflow>;
  try {
    baseUrl = normalizeLocalServiceUrl(
      settings.comfyuiBaseUrl ?? DEFAULT_COMFYUI_URL,
    );
    workflow = parseLocalImageWorkflow(settings.comfyuiWorkflow ?? "");
  } catch (error) {
    throw new DyadError(
      `Configure ComfyUI in Settings > AI: ${error instanceof Error ? error.message : "Invalid workflow"}`,
      DyadErrorKind.Validation,
    );
  }
  const seed = crypto.randomInt(0, 2 ** 48 - 1);
  for (const node of Object.values(workflow)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (value === "{{prompt}}") node.inputs[key] = prompt;
      if (value === "{{seed}}") node.inputs[key] = seed;
    }
  }
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(600_000)])
    : AbortSignal.timeout(600_000);
  const request = async (route: string, init?: RequestInit) =>
    fetch(`${baseUrl}${route}`, {
      ...init,
      signal,
      redirect: "error",
    });
  const json = async (response: Response) =>
    JSON.parse((await readBody(response, 2_000_000)).toString("utf8"));
  const submitted = z.object({ prompt_id: z.string().min(1) }).parse(
    await json(
      await request("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: workflow,
          client_id: crypto.randomUUID(),
        }),
      }),
    ),
  );
  const id = submitted.prompt_id;
  try {
    while (true) {
      signal.throwIfAborted();
      const history = await json(
        await request(`/history/${encodeURIComponent(id)}`),
      );
      const entry = history[id];
      if (entry?.status?.status_str === "error")
        throw new DyadError(
          "ComfyUI could not execute the workflow. Check installed models and its server log.",
          DyadErrorKind.External,
        );
      if (entry?.outputs) {
        for (const [nodeId, output] of Object.entries(entry.outputs)) {
          if (workflow[nodeId]?.class_type !== "SaveImage") continue;
          const parsed = z
            .object({
              images: z.array(
                z.object({
                  filename: z.string(),
                  subfolder: z.string(),
                  type: z.literal("output"),
                }),
              ),
            })
            .safeParse(output);
          const image = parsed.success ? parsed.data.images[0] : undefined;
          if (!image) continue;
          const query = new URLSearchParams(image);
          const bytes = await readBody(
            await request(`/view?${query}`),
            32_000_000,
          );
          if (
            !bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            throw new DyadError(
              "ComfyUI output is not a PNG image.",
              DyadErrorKind.External,
            );
          signal.throwIfAborted();
          return { b64_json: bytes.toString("base64") };
        }
        if (entry.status?.completed)
          throw new DyadError(
            "ComfyUI finished without a saved image.",
            DyadErrorKind.External,
          );
      }
      await delay(500, undefined, { signal });
    }
  } finally {
    if (signal.aborted) {
      // Remove only this queued job. Interrupting the server would cancel other users' jobs.
      await fetch(`${baseUrl}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [id] }),
        signal: AbortSignal.timeout(2_000),
        redirect: "error",
      }).catch(() => {});
    }
  }
}
