# sysadmin_chat_bot

## AI tools

The bot can expose a small set of external tools to the AI model through DeepSeek tool calls.

### Date/time

Always available. Default timezone:

```env
BOT_TIME_ZONE=Europe/Belgrade
```

### Internet tools

All HTTP-based tools are disabled unless explicitly enabled:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_TIMEOUT_MS=15000
AI_FETCH_TIMEOUT_MS=20000
AI_SEARCH_MAX_RESULTS=8
AI_FETCH_MAX_CHARS=30000
AI_MAX_TOOL_ROUNDS=3
```

Available tools when `AI_ALLOW_INTERNET=true`:

- `internet_fetch_url` — fetch readable text from a public HTTP/HTTPS URL.
- `stackexchange_search` — search StackOverflow, ServerFault, SuperUser, AskUbuntu, Unix/Linux.
- `wikipedia_search` — search Wikipedia through MediaWiki API.
- `github_search` — search GitHub repositories, issues, or code.

### General internet search provider

The public `internet_search` tool is provider-agnostic. The model calls only `internet_search`, and the bot chooses a configured provider internally.

Preferred local/private setup through SearXNG:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

Multiple providers can be configured as fallback chain:

```env
AI_SEARCH_PROVIDERS=searxng,brave
SEARXNG_URL=http://127.0.0.1:8888
BRAVE_SEARCH_API_KEY=xxxxxxxxxxxxxxxx
```

Supported general search providers:

- `searxng` — requires `SEARXNG_URL`; optional `SEARXNG_API_KEY` is sent as Bearer token.
- `brave` — requires `BRAVE_SEARCH_API_KEY`.

Optional GitHub token for higher limits and code search:

```env
GITHUB_SEARCH_TOKEN=github_pat_xxxxxxxxxxxxxxxx
```
