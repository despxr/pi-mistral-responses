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

/**
 * Mistral caps one Responses request at 20 images in total and rejects anything
 * larger with `400 3051: Total number of images exceeds the maximum allowed of
 * 20`. A long session that pastes screenshots or reads image files crosses that
 * line, and from then on every turn fails: the transcript, not the new message,
 * is what is too big. Pi keeps the transcript; this prunes the outgoing request
 * instead, keeping the newest images and replacing older ones with a short text
 * placeholder so the model still knows an image was there.
 *
 * `PI_MISTRAL_MAX_IMAGES` overrides the cap (`<= 0` disables pruning).
 */
const DEFAULT_MAX_IMAGES = 20;

/**
 * Prune a little below the cap so a session that keeps adding images does not
 * rewrite the request prefix on every turn. Each rewrite invalidates the prompt
 * cache from the first dropped image onward.
 */
const IMAGE_PRUNE_SLACK = 4;

const OMITTED_IMAGE_TEXT =
  "[image omitted: an older image was dropped to stay within the provider's per-request image limit]";

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
 * Collect every `input_image` item in a Responses payload, in request order.
 * Images live in user message content arrays and in `function_call_output`
 * arrays, so walk nested arrays and objects rather than assuming one shape.
 *
 * @param {unknown} node
 * @param {{ array: unknown[], index: number }[]} slots
 */
function collectImageSlots(node, slots) {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index++) {
      const item = node[index];
      if (!item || typeof item !== "object") continue;
      if (item.type === "input_image") slots.push({ array: node, index });
      else collectImageSlots(item, slots);
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") collectImageSlots(value, slots);
    }
  }
}

/**
 * Drop the oldest images from a Responses payload until at most `maxImages`
 * remain. Mutates the payload in place and returns it.
 *
 * @param {any} payload
 * @param {number} maxImages
 * @returns {any}
 */
export function pruneImages(payload, maxImages) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.input)) return payload;
  const slots = [];
  collectImageSlots(payload.input, slots);
  if (slots.length <= maxImages) return payload;
  const keep = Math.max(maxImages - IMAGE_PRUNE_SLACK, Math.ceil(maxImages * 0.8));
  const dropCount = slots.length - keep;
  for (let i = 0; i < dropCount; i++) {
    const { array, index } = slots[i];
    array[index] = { type: "input_text", text: OMITTED_IMAGE_TEXT };
  }
  return payload;
}

/** Cap from `PI_MISTRAL_MAX_IMAGES`, falling back to Mistral's limit. */
function maxImagesPerRequest() {
  const raw = process.env.PI_MISTRAL_MAX_IMAGES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_IMAGES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MAX_IMAGES;
}

/**
 * pi extension entrypoint. pi calls the default export with its ExtensionAPI.
 *
 * @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi
 */
export default function mistralResponses(pi) {
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "mistral-responses") return;
    const maxImages = maxImagesPerRequest();
    if (maxImages <= 0) return;
    return pruneImages(event.payload, maxImages);
  });

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
      // Mistral's hard per-request image cap. Pi does not enforce input limits
      // yet, so the `before_provider_request` hook above is what actually prunes.
      inputLimits: { images: { maxPerRequest: DEFAULT_MAX_IMAGES } },
    })),
  });
}
