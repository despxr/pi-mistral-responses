# pi-mistral-responses

Mistral models over the **stateless Responses API** for [pi](https://pi.dev), with prompt caching and cost tracking.

## Why

pi's built-in `mistral` provider speaks Chat Completions. That endpoint **rejects a replayed assistant `reasoning_content` with `422 extra_forbidden`**, so reasoning models — GLM, DeepSeek, Magistral — either lose their chain of thought between turns or fail outright. Every harness on Chat Completions hits this and "fixes" it by stripping reasoning, which quietly degrades multi-turn quality.

The Responses API carries reasoning as a first-class item that replays cleanly. This extension registers the same models on `openai-responses`, which pi already implements.

## Install

```bash
pi install /path/to/pi-mistral-responses
```

Then pick a model:

```bash
pi -m mistral-responses/deepseek-v4-1-flash-1017
```

Or use `/model` in the TUI.

## Make it the default

Both keys are required — `defaultModel` alone is silently ignored and pi falls
back to its built-in `mistral` provider on Chat Completions.

```json
// ~/.pi/agent/settings.json
{
  "defaultProvider": "mistral-responses",
  "defaultModel": "deepseek-v4-1-flash-1017"
}
```

## Credentials

Stored in `~/.pi/agent/auth.json`, one entry per provider id:

```json
{
  "mistral":           { "type": "api_key", "key": "..." },
  "mistral-responses": { "type": "api_key", "key": "..." }
}
```

Both entries are needed: the extension registers a *separate* provider id, and
pi resolves credentials by id rather than by the `apiKey` string in the
provider config. `MISTRAL_API_KEY` in the environment also works as a fallback.

`pi auth check --provider mistral-responses` reports `provider_not_found` — it
reads the static catalog and cannot see extension-registered providers. That is
not a failure; the runtime resolves the credential fine.

## Models

| Model | Reasoning | Vision | Context | Cost (in/out per 1M) |
|---|---|---|---|---|
| `deepseek-v4-1-flash-1017` | ✅ | ✅ | 1M | $0.30 / $1.20 |
| `zai-glm-5-3` | ✅ | ❌ | 1M | $1.40 / $4.40 |
| `zai-glm-5-3-flash` | ✅ | ✅ | 1M | $0.15 / $0.50 |
| `mistral-large-4` | ✅ | ✅ | 1M | $0.70 / $2.10 |
| `magistral-medium-latest` | ✅ | ✅ | 262k | $2.00 / $5.00 |

Vision flags come from the live `capabilities.vision` values on
`GET /v1/models`, not from pi's built-in catalog. The built-in catalog is stale
for `deepseek-v4-1-flash-1017` and `zai-glm-5-3-flash`: it marks both text-only
even though Mistral accepts `input_image` for them on `/v1/responses`.

`deepseek-v4-1-pro` is intentionally not registered: Mistral's API returns
`400 invalid_model` for it, so it is not a usable model id today.

`thinkingLevelMap` mirrors what the built-in provider declares, so pi's reasoning controls keep working — unsupported levels clamp instead of sending a value the model rejects with a 400.

## Image limit

Mistral caps a single Responses request at **20 images in total** and rejects
anything larger:

```
400 3051: Total number of images exceeds the maximum allowed of 20.
```

Because pi replays the whole transcript, a long session that pastes screenshots
or reads image files eventually crosses that line — and from then on *every*
turn fails, including messages that add no images. The session is stranded.

This extension prunes the outgoing request instead of the transcript. The newest
images are kept; older ones become a short text placeholder, so the model still
knows an image was there. The transcript on disk is never rewritten, and a
session that is already stuck starts working again once the extension is loaded
(restart or resume it).

Pruning drops slightly below the cap, so a session that keeps adding images does
not rewrite the request prefix on every turn (each rewrite invalidates the
prompt cache from the first dropped image onward). Override the cap with
`PI_MISTRAL_MAX_IMAGES`; `0` disables pruning.

The models also declare `inputLimits.images.maxPerRequest: 20`. Pi does not
enforce input limits yet, so the request hook is what actually prunes.

## Verified

Captured on the wire through a local proxy:

```
PATH=/v1/responses
KEYS=['model', 'input', 'stream', 'prompt_cache_key', 'store',
      'max_output_tokens', 'tools', 'reasoning', 'include']
```

`/v1/responses`, `input` array, `prompt_cache_key` present — the Responses wire, not Chat Completions.

Caching measured on a real run:

```
input 124, cacheRead 2176, output 3
cost $0.000056 (cache reads billed at 10%)
```

## Notes

- **baseUrl needs `/v1`.** pi's `openai-responses` adapter calls the OpenAI SDK's `client.responses.create`, which appends `/responses` to the base URL. Without `/v1` you get `404 no Route matched with those values`.
- **`store` is sent as false.** Mistral's Responses API is stateless; pi keeps the transcript.
- The built-in `mistral` provider is untouched — this registers a separate `mistral-responses` provider, so both are selectable.

## License

MIT.
