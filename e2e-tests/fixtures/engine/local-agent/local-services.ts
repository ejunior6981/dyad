import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Search and generate an image through local services",
  turns: [
    { toolCalls: [{ name: "web_search", args: { query: "React documentation" } }] },
    { toolCalls: [{ name: "generate_image", args: { prompt: 'An illustration of a "tree"' } }] },
    { text: "Local search and image generation complete." },
  ],
};
