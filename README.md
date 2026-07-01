# sysadmin_chat_bot

## AI tools

The bot can expose a small set of external tools to the AI model through DeepSeek tool calls.

### Date/time

Always available. Default timezone:

```env
BOT_TIME_ZONE=Europe/Belgrade
```

### Internet search

Internet search is disabled unless explicitly enabled:

```env
AI_ALLOW_INTERNET=true
BRAVE_SEARCH_API_KEY=xxxxxxxxxxxxxxxx
AI_SEARCH_TIMEOUT_MS=15000
AI_SEARCH_MAX_RESULTS=8
AI_MAX_TOOL_ROUNDS=3
```

The internet tool uses Brave Search API and returns source titles, URLs and snippets to the model.
