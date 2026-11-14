/**
 * pi-mistral-responses — Mistral on the stateless Responses API for pi.
 *
 * Why: pi's built-in `mistral` provider speaks Chat Completions. That endpoint
 * rejects a replayed assistant `reasoning_content` with `422 extra_forbidden`,
 * so reasoning models (GLM, DeepSeek, Magistral) either lose their chain of
 * thought between turns or fail outright. The Responses API carries reasoning as
 * a first-class item that replays cleanly.
 *
 * The models below are registered on `openai-responses`, which pi already
 * implements (including `prompt_cache_key`, so caching keeps working).
 *
 * Install:
 *   pi install /path/to/pi-mistral-responses      (or `-l` for project-local)
 * Then:
 *   pi -m mistral-responses/deepseek-v4-1-flash-1017
 */

/** USD per 1M tokens, from mistral.ai/pricing. */
const COST = {
  "deepseek-v4-1-flash-1017": { input: 0.3, output: 1.2, cacheRead: 0.007, cacheWrite: 0 },
  "zai-glm-5-3": { input: 1.4, output: 4.4, cacheRead: 0.14, cacheWrite: 0 },
  "zai-glm-5-3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
  "mistral-large-4": { input: 0.7, output: 2.1, cacheRead: 0.07, cacheWrite: 0 },
  "magistral-medium-latest": { input: 2, output: 5, cacheRead: 0.2, cacheWrite: 0 },
};

/**
 * Models exposed on the Responses wire.
 *
 * `thinkingLevelMap` mirrors what the built-in provider declares so pi's
 * reasoning controls keep working: null means the level is unsupported and pi
 * will clamp rather than send a level the model rejects with a 400.
 */
const MODELS = [
  {
    id: "deepseek-v4-1-flash-1017",
    name: "DeepSeek V4.1 Flash (Responses)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 128000,
    thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
  },
  {
    id: "zai-glm-5-3",
    name: "GLM-5.3 (Responses)",
    reasoning: true,
    contextWindow: 1048576,
    maxTokens: 131072,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
  },
  {
    id: "zai-glm-5-3-flash",
    name: "GLM-5.3-Flash (Responses)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 131072,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
  },
  {
    id: "mistral-large-4",
    name: "Mistral Large 4 (Responses)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 262144,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null },
  },
  {
    id: "magistral-medium-latest",
    name: "Magistral Medium (Responses)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 16384,
    thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null },
  },
];

/**
 * pi extension entrypoint. pi calls the default export with its ExtensionAPI.
 *
 * @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi
 */
export default function mistralResponses(pi) {
  pi.registerProvider("mistral-responses", {
    name: "Mistral (Responses)",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: "$MISTRAL_API_KEY",
    api: "openai-responses",
    authHeader: true,
    models: MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input ?? ["text"],
      cost: COST[model.id] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      thinkingLevelMap: model.thinkingLevelMap,
    })),
  });
}
