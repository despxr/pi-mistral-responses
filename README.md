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

Requires `MISTRAL_API_KEY` in the environment.

## Models

| Model | Reasoning | Context | Cost (in/out per 1M) |
|---|---|---|---|
| `deepseek-v4-1-flash-1017` | ✅ | 1M | $0.30 / $1.20 |
| `deepseek-v4-1-pro` | ✅ | 1M | $0.60 / $2.40 |
| `zai-glm-5-3` | ✅ | 1M | $1.40 / $4.40 |
| `zai-glm-5-3-flash` | ✅ | 1M | $0.15 / $0.50 |
| `mistral-large-4` | ✅ | 1M | $0.70 / $2.10 |
| `magistral-medium-latest` | ✅ | 262k | $2.00 / $5.00 |

`thinkingLevelMap` mirrors what the built-in provider declares, so pi's reasoning controls keep working — unsupported levels clamp instead of sending a value the model rejects with a 400.

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
