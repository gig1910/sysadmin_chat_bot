# SearXNG for sysadmin_chat_bot

Локальный/private SearXNG instance для `internet_search` tool в `sysadmin_chat_bot`.

Готовый пример рассчитан на localhost-only запуск:

```text
bot -> http://127.0.0.1:8888 -> searxng container:8080
```

## Главное требование

Для JSON API обязательно должен быть включён `json` в `search.formats`:

```yaml
search:
  formats:
    - html
    - json
```

Если `json` не включён, SearXNG web UI может работать, но запрос:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
```

вернёт `403 Forbidden`.

## Files

```text
examples/searxng/
├── docker-compose.yml
├── README.md
└── config/
    └── settings.yml
```

## First start

```bash
cd examples/searxng
mkdir -p config cache
docker compose up -d
```

Контейнер слушает только `127.0.0.1:8888`, поэтому снаружи сервера по сети он недоступен без отдельного reverse proxy.

## Checks

С хоста:

```bash
curl -i 'http://127.0.0.1:8888/'
curl -i 'http://127.0.0.1:8888/search?q=test'
curl -i 'http://127.0.0.1:8888/search?q=test&format=json'
```

Проверка JSON:

```bash
curl -s 'http://127.0.0.1:8888/search?q=test&format=json' | jq '.results | length'
```

Из контейнера:

```bash
docker exec -it searxng sh -lc "wget -q -O- 'http://127.0.0.1:8080/search?q=test&format=json' | head -c 500"
```

Проверка effective config:

```bash
docker exec -it searxng sh -lc "grep -nA20 '^search:' /etc/searxng/settings.yml"
docker exec -it searxng sh -lc "grep -nA20 '^server:' /etc/searxng/settings.yml"
```

Логи:

```bash
docker logs --tail=200 searxng
```

## Bot `.env`

Минимально для SearXNG provider:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

Если нужен fallback, например SearXNG -> Brave:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDERS=searxng,brave
SEARXNG_URL=http://127.0.0.1:8888
BRAVE_SEARCH_API_KEY=
```

Опционально, если перед SearXNG стоит reverse proxy с Bearer auth:

```env
SEARXNG_API_KEY=
```

## Common failures

### Web UI works, JSON returns 403

Причина: `json` не включён в `search.formats`.

Исправление:

```yaml
search:
  formats:
    - html
    - json
```

Перезапуск:

```bash
docker compose restart searxng
```

### JSON returns HTML

Обычно запрос попадает не в SearXNG API endpoint, а в reverse proxy или другой сервис. Проверь port mapping и `SEARXNG_URL`.

### Healthcheck fails

```bash
docker compose ps
docker logs --tail=200 searxng
curl -i 'http://127.0.0.1:8888/search?q=health&format=json'
```

### Limiter blocks curl or bot

Этот пример держит `server.limiter: false`. Если включаешь limiter, настраивай Valkey и trusted proxy headers.

## Security notes

- Не публикуй SearXNG наружу без limiter/auth.
- Для локального использования ботом достаточно binding `127.0.0.1:8888`.
- Не добавляй реальные API keys в README или compose-файлы.
