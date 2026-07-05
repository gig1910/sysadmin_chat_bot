# SearXNG for sysadmin_chat_bot

This example is a local/private SearXNG instance for the bot.

The critical setting for JSON API access is:

```yaml
search:
  formats:
    - html
    - json
```

If `json` is not enabled in `search.formats`, SearXNG returns `403 Forbidden` for:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
```

while the regular web UI still works.

## Files

```text
examples/searxng/
├── docker-compose.yml
└── config/
    └── settings.yml
```

## First start

```bash
cd examples/searxng
mkdir -p config cache

# Recommended: replace server.secret_key in config/settings.yml before public exposure.
# For localhost-only testing it is not important, but do not expose a default config publicly.

docker compose up -d
```

## Checks

From host:

```bash
curl -i 'http://127.0.0.1:8888/'
curl -i 'http://127.0.0.1:8888/search?q=test'
curl -i 'http://127.0.0.1:8888/search?q=test&format=json'
```

Expected JSON check:

```bash
curl -s 'http://127.0.0.1:8888/search?q=test&format=json' | jq '.results | length'
```

From inside container:

```bash
docker exec -it searxng sh -lc "wget -q -O- 'http://127.0.0.1:8080/search?q=test&format=json' | head -c 500"
```

Inspect effective config:

```bash
docker exec -it searxng sh -lc "grep -nA20 '^search:' /etc/searxng/settings.yml"
docker exec -it searxng sh -lc "grep -nA20 '^server:' /etc/searxng/settings.yml"
```

Logs:

```bash
docker logs --tail=200 searxng
```

## Bot `.env`

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

## Common failures

### Web UI works, JSON returns 403

Cause: `json` is not enabled in `search.formats`.

Fix:

```yaml
search:
  formats:
    - html
    - json
```

Restart:

```bash
docker compose restart searxng
```

### JSON returns HTML

Usually the request is reaching a reverse proxy or a different service, not the configured SearXNG API endpoint. Check port mapping and `SEARXNG_URL`.

### Healthcheck fails

Run:

```bash
docker compose ps
docker logs --tail=200 searxng
curl -i 'http://127.0.0.1:8888/search?q=health&format=json'
```

### Limiter blocks curl or bot

This example keeps `server.limiter: false`. If you enable limiter, configure Valkey and trusted proxy headers correctly.
