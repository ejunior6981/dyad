# Personal local-model customization

This fork keeps `origin` pointed at `ejunior6981/dyad`, `upstream` at
`dyad-sh/dyad`, and customization work on `custom`.

## Local semantic code search

Select your Qwen model through Dyad's LM Studio provider, start LM Studio's
local server, and keep Ollama running with `bge-m3` installed. The coding model
and embedding model can run in separate applications.

In Agent, Ask, or Plan mode, the `code_search` tool now uses local embeddings
when the effective model for that chat is from LM Studio or Ollama. It does
not require a Dyad Pro key or call Dyad Engine. Local Build selections resolve
to full Agent automatically, including previously saved Build chats.

Optional `.env` configuration:

```dotenv
DYAD_LOCAL_CODE_SEARCH=true
DYAD_LOCAL_EMBEDDING_URL=http://127.0.0.1:11434
DYAD_LOCAL_EMBEDDING_MODEL=bge-m3
```

The embedding endpoint must be a loopback Ollama server. LM Studio continues
to serve Qwen; this URL is for embeddings, not chat completions.

Search combines cosine similarity and keyword matches, returning up to eight
code chunks with file names, line ranges, and excerpts. Changed files are
re-embedded; unchanged files reuse their cached vectors. Deleted files never
appear in results. Environment files are excluded.

The initial index uses disposable JSON vector caches under the app's
`userData/local-code-search` directory rather than introducing another database
service or native dependency. Cache files contain content hashes and vectors,
not raw source text. They are isolated by project, endpoint, and embedding
model. Deleting this directory forces a rebuild, including after replacing
model weights under the same model name. Disk use can accumulate for old
projects; there is no automatic cache pruning yet.

The first search may take longer while indexing. Searches are currently limited
to 4,000 chunks of roughly 3,000 characters each. Indexing requests are batched,
and scoring yields to the main event loop. This is intended for ordinary app
projects; larger projects will need a worker and a database-backed index.

## Full Agent on local models

LM Studio and Ollama sessions now use full Agent capabilities without the
Basic Agent daily message quota. The model dropdown shows Agent, cached quota
errors do not block local chats, and local turns do not reserve or consume
Basic Agent quota. Switching to an unpaid cloud model retains the upstream
quota behavior.

Explorer, Reviewer, Implementer, and advanced subagent controls are available
through the existing Sub-agents settings. Child agents use the same local
model as the accepted root turn. Local inference and subagent inference never
check or report Dyad credits, even when old Pro credentials remain in settings.
These request-only overrides do not modify the stored Pro configuration.

Hosted search, image generation, history research, voice transcription, and
the hosted shell safety reviewer still require their respective backends.
Local Agent does not expose those tools through fake Pro credentials. Existing
tool approvals, Ask/Plan read-only boundaries, and the configurable per-turn
step limits remain in place; these are also part of full Agent operation.
Local search failures never fall back to a paid service.

## Development and checks

Dyad requires Node 24 or 25. Install dependencies and initialize hooks as
described in `CONTRIBUTING.md`. Tests that import the app also require Electron
and its native dependencies. Install `testing/fake-llm-server` dependencies
before the full type check.

```powershell
npm test -- src/ipc/utils/local_code_search.test.ts src/pro/main/ipc/handlers/local_agent/tools/code_search.spec.ts src/pro/main/ipc/handlers/local_agent/tool_definitions.test.ts
```

An optional live test uses synthetic source files against your running Ollama:

```powershell
$env:DYAD_LOCAL_SEARCH_SMOKE = 'true'
npm test -- src/ipc/utils/local_code_search.live.test.ts
Remove-Item Env:DYAD_LOCAL_SEARCH_SMOKE
```

## Bringing in creator updates

Commit your work and confirm the working tree is clean first. Integrate on a
temporary branch so `custom` remains usable while conflicts and tests are
being resolved:

```powershell
git fetch upstream
git switch custom
git switch -c sync/upstream-YYYY-MM-DD
git merge upstream/main
```

Resolve conflicts, install changed dependencies, and run the relevant checks.
Once the integration works:

```powershell
git switch custom
git merge --ff-only sync/upstream-YYYY-MM-DD
git push origin custom
```

## Local web search

Run `powershell -NoProfile -ExecutionPolicy Bypass -File local-services/searxng/start.ps1`
from this repository. The script starts SearXNG through Docker, generates an
ignored local secret, and binds the service to `http://127.0.0.1:8080`.
Docker Desktop must be running. Stop it with
`docker compose --project-directory local-services/searxng -f local-services/searxng/compose.yaml down`.
The Compose file pins the tested container image by digest. To update SearXNG,
pull a newer official image and replace the digest after checking JSON searches.

Settings → AI contains the Local web search switch and SearXNG URL.
Local Agent's `web_search` uses this service automatically with LM Studio or
Ollama, including Explorer subagents. It returns source URLs and snippets for
the model to cite. Queries require an internet connection and are forwarded
by SearXNG to search engines; no subscription or API key is required.
The checked-in configuration enables JSON results and Google/Bing. Other
engines can be configured in `local-services/searxng/settings.yml`.
CAPTCHA, rate limits, and network failures can still affect upstream engines.
This is snippet search; the hosted `web_fetch` and `web_crawl` tools are
not enabled for local models yet.

The search endpoint accepts only localhost URLs, rejects redirects, bounds
response size/results, and honors cancellation. Failure never falls back to
Dyad's paid engine. The consent setting still applies to web searches.

## Local image generation

Start ComfyUI on `http://127.0.0.1:8188` with a locally installed image model.
In ComfyUI, export the working workflow using **Export (API)**. Replace the
positive prompt's text value with exactly `{{prompt}}`; optionally replace
its seed with `{{seed}}` to randomize each generation. Keep a `SaveImage`
output. Paste the JSON into Settings → AI → ComfyUI API workflow and save.
The URL can also be changed to another localhost port.

`local-services/comfyui/workflow.example.json` is a starter checkpoint
workflow. Set its `ckpt_name` to your installed checkpoint's filename before
using it. Use a workflow that already works in ComfyUI for Flux or SDXL.
The integration accepts an explicit allowlist of built-in local model nodes;
hosted API nodes and custom nodes are rejected. Clear the saved workflow to
disable the image tool.

Both the Agent's `generate_image` tool and the Generate Image dialog use
ComfyUI with a local model selected. Generated PNGs are saved in the app's
`.dyad/media` directory through the existing image flows. The dialog applies
the selected visual style to the prompt. No Pro key or credit check is used.
Generation has a ten-minute deadline and downloads are size-limited.
Cancelling removes this request from ComfyUI's pending queue; an already
running render may finish in ComfyUI because a global interrupt could cancel
someone else's job. Dyad stops waiting and does not save a cancelled result.

ComfyUI and image checkpoints are separate installations; this repository
does not download model weights automatically.

For an existing Comfy Desktop installation on Windows, the included helper
discovers its registered local instance and Python environment:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File local-services/comfyui/start.ps1
```

It starts a background server on port 8188 using existing models and user
directories, with custom nodes disabled for the built-in Dyad workflow.
To stop only the helper-owned server before launching the Desktop UI:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File local-services/comfyui/stop.ps1
```

The stop helper refuses to interrupt running or queued renders. Logs and the
PID record are kept in the ignored `.runtime` directory. Comfy Desktop's own
launch arguments should also use `--listen 127.0.0.1 --port 8188`.

`workflow.sd15.json` is configured for the installed
`v1-5-pruned-emaonly.ckpt` checkpoint and has been verified against the real
ComfyUI server on an RTX 5060 Ti. Paste this file into the customized Dyad
build's ComfyUI API workflow setting. The original upstream Dyad executable
does not include this fork's local-image integration.

An opt-in end-to-end render check exercises the actual ComfyUI queue, history,
and image-download APIs through Dyad's adapter:

```powershell
$env:DYAD_LOCAL_IMAGE_SMOKE = 'true'
npm test -- src/ipc/utils/local_image_generation.live.test.ts
Remove-Item Env:DYAD_LOCAL_IMAGE_SMOKE
```

The test writes its PNG to `local-services/comfyui/.runtime/smoke-output.png`.

SearXNG's JSON API and ComfyUI's workflow protocol follow the official
[SearXNG API docs](https://docs.searxng.org/dev/search_api.html) and
[ComfyUI API examples](https://github.com/Comfy-Org/ComfyUI/tree/master/script_examples).

Verification:

```powershell
npm test -- src/ipc/utils/local_web_search.test.ts src/ipc/utils/local_image_generation.test.ts src/ipc/handlers/chat_stream_local_agent.integration.test.ts
$env:DYAD_LOCAL_WEB_SEARCH_SMOKE = 'true'
npm test -- src/ipc/utils/local_web_search.live.test.ts
Remove-Item Env:DYAD_LOCAL_WEB_SEARCH_SMOKE
```
