# Personal local-model customization

This fork keeps `origin` pointed at `ejunior6981/dyad`, `upstream` at
`dyad-sh/dyad`, and customization work on `custom`.

## Local semantic code search

Select your Qwen model through Dyad's LM Studio provider, start LM Studio's
local server, and keep Ollama running with `bge-m3` installed. The coding model
and embedding model can run in separate applications.

In Agent, Ask, or Plan mode, the `code_search` tool now uses local embeddings
when the effective model for that chat is from LM Studio or Ollama. It does
not require a Dyad Pro key or call Dyad Engine. Build mode retains its
upstream tool inventory and does not expose semantic search.

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

Future work: local SearXNG search and page extraction, then ComfyUI image
generation and replacements for the remaining hosted tools.
