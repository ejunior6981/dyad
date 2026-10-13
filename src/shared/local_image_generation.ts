import { z } from "zod";

export const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
const LOCAL_NODE_TYPES = new Set([
  "CheckpointLoaderSimple",
  "CLIPLoader",
  "DualCLIPLoader",
  "TripleCLIPLoader",
  "UNETLoader",
  "VAELoader",
  "CLIPTextEncode",
  "EmptyLatentImage",
  "EmptySD3LatentImage",
  "KSampler",
  "KSamplerAdvanced",
  "VAEDecode",
  "SaveImage",
  "FluxGuidance",
  "ModelSamplingFlux",
  "ModelSamplingSD3",
  "CLIPSetLastLayer",
  "LoraLoader",
  "LoraLoaderModelOnly",
  "ConditioningZeroOut",
  "ConditioningCombine",
  "ConditioningSetTimestepRange",
  "RandomNoise",
  "BasicGuider",
  "CFGGuider",
  "BasicScheduler",
  "KSamplerSelect",
  "SamplerCustomAdvanced",
]);
const workflowSchema = z.record(
  z.string(),
  z
    .object({
      class_type: z.string(),
      inputs: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
);

export function parseLocalImageWorkflow(value: string) {
  if (value.length > 200_000)
    throw new Error("ComfyUI workflow exceeds 200 KB.");
  const workflow = workflowSchema.parse(JSON.parse(value));
  const nodes = Object.values(workflow);
  if (!nodes.length || nodes.length > 100)
    throw new Error("Use a workflow with 1–100 nodes.");
  for (const node of nodes) {
    if (!LOCAL_NODE_TYPES.has(node.class_type)) {
      throw new Error(
        `Unsupported local node: ${node.class_type}. Use built-in local model nodes; hosted API and custom nodes are excluded.`,
      );
    }
  }
  if (!nodes.some((node) => node.class_type === "SaveImage"))
    throw new Error("The workflow needs a SaveImage output node.");
  if (
    !nodes.some((node) => Object.values(node.inputs).includes("{{prompt}}"))
  ) {
    throw new Error(
      'Replace the positive prompt input with exactly "{{prompt}}".',
    );
  }
  return workflow;
}
