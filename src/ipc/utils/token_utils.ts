import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "@/ipc/types";
import { getErrorMessage } from "@ai-sdk/provider";

import { findLanguageModel } from "./findLanguageModel";
import { getLmStudioBaseUrl } from "./lm_studio_utils";
import { asSchema, type ModelMessage, type ToolSet } from "ai";

// Estimate tokens (4 characters per token)
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

type ToolResultForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

type ToolErrorForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  error: unknown;
};

/**
 * Estimate the tokens that completed tool results will add to the next model
 * request. Tool inputs are intentionally excluded because the engine's usage
 * for the completed step already counted them.
 */
export const estimateToolResultTokens = (
  toolResults: readonly ToolResultForTokenEstimate[],
  toolErrors: readonly ToolErrorForTokenEstimate[] = [],
): number => {
  if (toolResults.length === 0 && toolErrors.length === 0) {
    return 0;
  }

  const serializedResults = JSON.stringify(
    [
      ...toolResults.map(({ toolCallId, toolName, output }) => ({
        type: "tool-result",
        toolCallId,
        toolName,
        output,
      })),
      ...toolErrors.map(({ toolCallId, toolName, error }) => ({
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "error-text", value: getErrorMessage(error) },
      })),
    ],
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );

  return estimateTokens(serializedResults);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0,
  );
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export async function getContextWindow(model?: LargeLanguageModel) {
  const selectedModel = model ?? readSettings().selectedModel;
  if (selectedModel.provider === "lmstudio") {
    // The architecture maximum is not the context allocated to a loaded model.
    // Read the server on each lookup so reloading with a different limit takes effect.
    try {
      const response = await fetch(`${getLmStudioBaseUrl()}/api/v0/models`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const { data } = await response.json();
        const loaded = data?.find(
          (entry: { id: string; state: string }) =>
            entry.id === selectedModel.name && entry.state === "loaded",
        );
        const context = loaded?.loaded_context_length;
        if (Number.isSafeInteger(context) && context > 0) return context;
      }
    } catch {
      // Older servers may not expose allocation metadata. Use a conservative
      // local fallback rather than the 128K cloud default.
    }
    return 32_768;
  }
  const modelOption = await findLanguageModel(selectedModel);
  return modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

export async function getMaxTokens(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.maxOutputTokens ?? undefined;
}

export async function getTemperature(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.temperature ?? undefined;
}

/**
 * Calculate the token threshold for triggering context compaction.
 *
 * Returns the lower of a per-provider cap or `contextWindow - 25k`. The 25k
 * headroom leaves room for the next user message + tool outputs before we hit
 * the hard context limit.
 *
 * Per-provider caps differ because of input-token pricing tiers and operational
 * headroom. Google compacts before its 200k pricing boundary, while OpenAI
 * compacts at 220k to leave more room for tool-heavy agent steps. Other
 * providers retain the historical 250k cap.
 */
export function getCompactionThreshold(
  contextWindow: number,
  provider: string,
): number {
  if (provider === "lmstudio" || provider === "ollama") {
    return Math.floor(contextWindow * 0.75);
  }
  const cap =
    provider === "google" ? 190_000 : provider === "openai" ? 220_000 : 250_000;
  return Math.min(cap, Math.max(0, contextWindow - 25_000));
}

/** Include the system prompt and actual tool schemas, even before usage exists. */
export async function estimateAgentRequestTokens(
  system: string,
  messages: ModelMessage[],
  tools: ToolSet,
): Promise<number> {
  const declarations = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      parameters: await asSchema(tool.inputSchema).jsonSchema,
    })),
  );
  // Local tokenizers vary, especially for code and JSON. Use three characters
  // per token plus framing headroom rather than the four-character UI estimate.
  return (
    Math.ceil(
      JSON.stringify({ system, messages, tools: declarations }).length / 3,
    ) + 512
  );
}

/**
 * Check if compaction should be triggered based on total tokens used.
 */
export function shouldTriggerCompaction(
  totalTokens: number,
  contextWindow: number,
  provider: string,
): boolean {
  return totalTokens >= getCompactionThreshold(contextWindow, provider);
}
