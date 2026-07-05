# sysadmin_chat_bot

Telegram-бот для группы «Системный Администратор»: модерация новых участников, хранение истории сообщений в PostgreSQL, антиспам-проверка через DeepSeek, диалоговый AI-помощник, сводки по чату и внешний tool-calling для даты/времени и поиска информации.

Проект написан на Node.js ESM и использует Telegraf, PostgreSQL, OpenAI-compatible SDK с DeepSeek API и набор собственных AI tools.

## Содержание

- [Что умеет бот](#что-умеет-бот)
- [Архитектура](#архитектура)
- [Требования](#требования)
- [Установка](#установка)
- [Настройка `.env`](#настройка-env)
- [Настройка PostgreSQL](#настройка-postgresql)
- [Запуск](#запуск)
- [Команды Telegram](#команды-telegram)
- [AI-режимы и контекст диалога](#ai-режимы-и-контекст-диалога)
- [AI tools и интернет-доступ](#ai-tools-и-интернет-доступ)
- [SearXNG](#searxng)
- [Markdown, URL и таблицы Telegram](#markdown-url-и-таблицы-telegram)
- [Хранение данных](#хранение-данных)
- [Логирование](#логирование)
- [Обслуживание](#обслуживание)
- [Безопасность](#безопасность)
- [Известные ограничения](#известные-ограничения)
- [Структура проекта](#структура-проекта)

## Что умеет бот

Основной функционал:

- приветствует новых участников группы;
- требует принять правила через inline-кнопку;
- удаляет сообщения новых участников до принятия правил;
- отправляет первое текстовое сообщение нового участника на AI-проверку спама;
- банит очевидных спамеров;
- автоматически удаляет пользователей, которые не приняли правила в течение заданного времени;
- сохраняет чаты, пользователей, связи пользователь/чат и сообщения в PostgreSQL;
- удаляет старые сохранённые сообщения по `CHATS.CLEAR_INTERVAL`;
- отвечает в личных сообщениях через DeepSeek;
- отвечает в группе, если пользователь отвечает на сообщение AI-бота или на цепочку диалога с AI;
- умеет обычный AI-ответ и режим анализа;
- умеет делать сводку сообщений за интервал;
- поддерживает настройки AI per-chat через БД;
- хранит AI-запросы, ответы и ошибки в таблице `AI_REQUEST`;
- передаёт AI историю диалога как JSON-контекст с `role`, `name`, `message_id`, `reply_to`, `content`;
- учитывает Telegram quote: если пользователь ответил с выделенной цитатой, `message.quote.text` добавляется в AI-запрос как явный фокус проверки;
- распаковывает ошибочный JSON-wrapper ответа AI вида `{"role":"assistant","content":"..."}` и отправляет в Telegram только `content`;
- разбивает длинные Telegram-сообщения на части;
- конвертирует Markdown в Telegram entities;
- мягко детектирует обычные URL в тексте и добавляет Telegram entity `url`;
- рендерит Markdown-таблицы в моноширинные `pre`-блоки с переносом длинных ячеек;
- поддерживает tool-calling: дата/время, чтение URL, общий поиск, Wikipedia, StackExchange, GitHub.

## Архитектура

Упрощённый поток обработки:

```text
Telegram update
  ↓
index.mjs
  ↓
common/telegram.mjs        — Telegram helpers, отправка/удаление/админ-проверки
common/telegram_db.mjs     — запись и чтение PostgreSQL
common/deepseek.mjs        — AI-запросы, спам, диалоги, summary, quote-aware контекст
common/ai_tools.mjs        — tools для AI: дата, URL, поиск, GitHub, Wikipedia, StackExchange
common/parser.mjs          — Markdown → Telegram entities, таблицы, URL, разбиение длинных сообщений
common/logger.mjs          — простой файловый логгер
common/db.mjs              — PostgreSQL pool
```

AI-запросы идут через пакет `openai`, но с `baseURL: https://api.deepseek.com`, то есть используется OpenAI-compatible интерфейс DeepSeek.

## Требования

Рекомендуемая среда:

- Node.js 20+;
- PostgreSQL 14+;
- Telegram Bot Token;
- DeepSeek API key;
- опционально Docker/Podman для локального SearXNG;
- доступ бота к группе с правами администратора, если требуется банить пользователей и удалять сообщения.

Зависимости проекта указаны в `package.json`:

- `telegraf`;
- `pg`;
- `openai`;
- `dotenv`;
- `markdown-it`;
- `node-fetch`.

## Установка

```bash
git clone git@github.com:gig1910/sysadmin_chat_bot.git
cd sysadmin_chat_bot
npm install
mkdir -p logs
```

Проверка синтаксиса:

```bash
node --check index.mjs
node --check common/deepseek.mjs
node --check common/ai_tools.mjs
node --check common/telegram.mjs
node --check common/telegram_db.mjs
node --check common/parser.mjs
```

## Настройка `.env`

Актуальный пример лежит в `.env.example`.

Минимальный пример:

```env
# PostgreSQL
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=sysadmin_chat_bot
DB_USER=sysadmin_chat_bot
DB_PASS=

# Telegram
TOKEN=
TELEGRAM_MAX_MESSAGE_LENGTH=4000
TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE=10000
TELEGRAM_TIMEOUT_TO_DELETE_QUESTION=60000

# DeepSeek
DEEPSEEK_API_KEY=

# Local time for AI date/time tool
BOT_TIME_ZONE=Europe/Belgrade

# AI tools / internet
AI_ALLOW_INTERNET=false
AI_MAX_TOOL_ROUNDS=3
```

### Обязательные переменные

```env
TOKEN=
DB_NAME=
DB_USER=
DB_PASS=
DEEPSEEK_API_KEY=
```

`DB_HOST` по умолчанию `127.0.0.1`, `DB_PORT` по умолчанию `5432`.

`TOKEN` — именно такое имя переменной используется в коде, не `BOT_TOKEN`.

### Markdown/table rendering

```env
TELEGRAM_MAX_MESSAGE_LENGTH=4000
TELEGRAM_TABLE_MAX_CELL_WIDTH=32
TELEGRAM_TABLE_MAX_WIDTH=100
```

`TELEGRAM_TABLE_MAX_CELL_WIDTH` ограничивает ширину одной ячейки при рендере Markdown-таблиц в Telegram.

`TELEGRAM_TABLE_MAX_WIDTH` ограничивает общую ширину preformatted table. Если таблица шире, самые широкие колонки постепенно ужимаются до минимума.

### AI tools / internet

```env
AI_ALLOW_INTERNET=false
AI_SEARCH_PROVIDER=none
AI_MAX_TOOL_ROUNDS=3
AI_SEARCH_TIMEOUT_MS=15000
AI_FETCH_TIMEOUT_MS=20000
AI_CONFIG_CHECK_TIMEOUT_MS=5000
AI_SEARCH_MAX_RESULTS=8
AI_FETCH_MAX_CHARS=30000
```

Для общего поиска через SearXNG:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

Для fallback-цепочки провайдеров:

```env
AI_SEARCH_PROVIDERS=searxng,brave
```

Поддержанные provider names:

- `searxng`;
- `brave`;
- `none`, `off`, `false`, `disabled`, `disable`, `0` — отключить общий поиск.

Опциональные ключи:

```env
SEARXNG_API_KEY=
BRAVE_SEARCH_API_KEY=
GITHUB_SEARCH_TOKEN=
```

## Настройка PostgreSQL

DDL лежит в:

```text
SQL/DDL.sql
```

Скрипт создаёт схему:

```sql
SYSADMIN_CHAT_BOT
```

и таблицы:

- `CHATS`;
- `USERS`;
- `USERS_CHATS`;
- `MESSAGES`;
- `AIS`;
- `AI_KINDS`;
- `AI_MODELS`;
- `AI_REQUEST`;
- `AI2CHAT_SETTINGS`.

Пример создания БД и пользователя:

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE sysadmin_chat_bot;
CREATE USER sysadmin_chat_bot WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE sysadmin_chat_bot TO sysadmin_chat_bot;
\q
```

Загрузка DDL:

```bash
psql \
  --host=127.0.0.1 \
  --username=sysadmin_chat_bot \
  --dbname=sysadmin_chat_bot \
  --file=SQL/DDL.sql
```

Так как SQL-запросы в коде обращаются к таблицам без явного указания схемы, для пользователя БД нужно выставить `search_path`:

```sql
ALTER ROLE sysadmin_chat_bot IN DATABASE sysadmin_chat_bot
  SET search_path = SYSADMIN_CHAT_BOT, public;
```

Или выставить `search_path` на уровне базы:

```sql
ALTER DATABASE sysadmin_chat_bot
  SET search_path = SYSADMIN_CHAT_BOT, public;
```

После изменения `search_path` переподключи приложение.

### Начальные AI-настройки

`SQL/DDL.sql` содержит пример начальных настроек для конкретного Telegram chat id. Для своего чата нужно либо заменить `CHAT_ID` в SQL, либо добавить настройки через таблицу `AI2CHAT_SETTINGS`.

Основные типы настроек:

- `SYSTEM_PROMPT`;
- `SUMMARY_PROMPT`;
- `TEST_SPAM_PROMPT`;
- `TEMPERATURE`;
- `MESSAGE_LIMIT`.

`REASONER_MODE=false` — обычный режим.

`REASONER_MODE=true` — режим анализа.

## Запуск

```bash
npm run run
```

или напрямую:

```bash
node index.mjs
```

При старте бот:

1. открывает соединение с PostgreSQL;
2. выполняет `SELECT 1`;
3. проверяет конфигурацию AI tools;
4. запускает Telegram bot polling;
5. запускает периодический обработчик очистки.

## Команды Telegram

### Общие команды

```text
/start
/help
/getchatid
/question
```

### AI-команды

```text
/deepseek <вопрос>
/deepseek_analyse <вопрос>
/deepseek_summary 2h
/deepseek_summary 30m
/deepseek_summary 1d
/deepseek_summary 2h что изменилось по теме PostgreSQL?
/deepseek_test_spam <текст>
```

`/deepseek_summary` поддерживает суффиксы:

- `m` — минуты;
- `h` — часы;
- `d` — дни.

Если интервал не указан, используется `2h`.

### Админ-команды AI-настроек

```text
/get_ai_settings
/set_ai_settings <true|false> <TYPE> <VALUE>
```

Примеры:

```text
/set_ai_settings false SYSTEM_PROMPT Ты помощник в техническом чате.
/set_ai_settings true TEMPERATURE 1.0
/set_ai_settings false MESSAGE_LIMIT 30
```

Где первый параметр:

- `false` — обычный режим;
- `true` — режим анализа.

Команда доступна только администраторам группы.

Текущий known issue: в `index.mjs` у обработчика `/set_ai_settings` ещё есть опечатка в regex очистки команды (`set_ai_settints` вместо `set_ai_settings`), а также regex настройки может требовать расширения под `MESSAGE_LIMIT`. Документация и `.env.example` уже описывают желаемый формат; кодовую правку нужно внести отдельно.

## AI-режимы и контекст диалога

### Обычный диалог

В личных сообщениях бот автоматически отправляет текст в DeepSeek.

В группе бот отвечает только если:

- пользователь отвечает на приветственное сообщение AI-помощника;
- пользователь отвечает на цепочку сообщений, где уже был `/deepseek`;
- используется команда `/deepseek` или `/deepseek_analyse`.

История диалога строится рекурсивно по `reply_to_message.message_id` из таблицы `MESSAGES`. По умолчанию берётся до 20 сообщений, либо значение из настройки `MESSAGE_LIMIT`.

### JSON-контекст сообщений

История передаётся модели не как простой текст, а как JSON внутри `content` каждого chat message. Это сделано специально для групповых диалогов, чтобы модель не теряла автора сообщения.

Типовая структура:

```json
{
  "role": "user",
  "name": "username",
  "message_id": 12345,
  "reply_to": 12344,
  "content": "Текст сообщения"
}
```

Если модель ошибочно возвращает наружу JSON-wrapper вида:

```json
{"role":"assistant","name":null,"content":"Текст ответа"}
```

бот распаковывает `content` и отправляет в Telegram только текст ответа.

### Telegram quote

Если пользователь отвечает с выделенной цитатой, Telegram присылает `message.quote`. Бот добавляет в конец AI-контекста отдельное служебное сообщение с:

```json
{
  "quote": {
    "text": "выделенный фрагмент",
    "position": 100,
    "is_manual": true
  },
  "instruction": "Use quote.text as the primary focus of the latest user request. Use the reply chain only as context."
}
```

Это позволяет модели понимать, что перепроверять нужно не весь предыдущий ответ, а конкретный процитированный фрагмент.

### Анализ

`/deepseek_analyse` использует те же сообщения, но берёт настройки с `REASONER_MODE=true` и включает дополнительные параметры анализа при запросе к модели.

### Summary

`/deepseek_summary` берёт сообщения из текущего чата за указанный интервал, исключает команды и отправляет массив сообщений в AI для анализа.

Для summary нужен `SUMMARY_PROMPT` в `AI2CHAT_SETTINGS`.

## AI tools и интернет-доступ

AI tools регистрируются только для обычных сообщений и summary. Спам-проверка их не использует.

### Базовый tool даты/времени

`get_current_datetime` доступен всегда.

Он возвращает:

- Unix time;
- UTC ISO;
- локальную дату;
- локальное время;
- timezone;
- weekday.

Часовой пояс задаётся:

```env
BOT_TIME_ZONE=Europe/Belgrade
```

### HTTP tools

HTTP-based tools включаются только так:

```env
AI_ALLOW_INTERNET=true
```

Тогда доступны:

- `internet_fetch_url` — чтение конкретной публичной HTTP/HTTPS-ссылки;
- `stackexchange_search` — поиск по StackOverflow, ServerFault, SuperUser, AskUbuntu, Unix/Linux;
- `wikipedia_search` — поиск через MediaWiki API;
- `github_search` — поиск по GitHub repositories/issues/code;
- `internet_search` — общий поиск через настроенный provider.

`AI_MAX_TOOL_ROUNDS` ограничивает количество последовательных tool-calls, чтобы модель не ушла в бесконечный цикл.

## SearXNG

Рекомендуемый бесплатный provider общего поиска.

Готовый пример лежит в:

```text
examples/searxng/
```

Запуск:

```bash
cd examples/searxng
mkdir -p config cache
docker compose up -d
```

Проверка JSON API:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
```

`.env` для бота:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

Критически важно, чтобы в `settings.yml` был разрешён JSON output:

```yaml
search:
  formats:
    - html
    - json
```

Если `json` не включён, SearXNG web UI может работать, но `/search?...&format=json` вернёт `403 Forbidden`.

## Markdown, URL и таблицы Telegram

Telegram не поддерживает настоящие Markdown-таблицы. Поэтому `common/parser.mjs` делает специальную обработку:

- парсит Markdown через `markdown-it`;
- передаёт `env.references`, чтобы фрагменты вида `[текст]` не валили reference-link parser;
- при ошибке Markdown parser делает plain-text fallback;
- конвертирует оформление в Telegram entities;
- поддерживает inline code, code fences, bold, italic, underline, strikethrough, links, blockquote;
- мягко детектирует обычные `http://`, `https://` и `www.` URL;
- разбивает длинный ответ на части до `TELEGRAM_MAX_MESSAGE_LENGTH`;
- старается сохранять корректные offsets entities после разбиения.

Markdown-таблицы рендерятся в моноширинный `pre`-блок:

```text
Источник      | Тип          | Позиция
--------------+--------------+----------------
Минобороны РФ | Официальный  | Город под...
              | источник     | контролем...
```

Это не настоящая Telegram table, но такой формат намного читаемее на мобильном клиенте, чем обычная строка с `|`.

## Хранение данных

### CHATS

Хранит Telegram-чаты:

- id;
- type;
- title;
- invite link;
- permissions;
- raw Telegram object;
- `CLEAR_INTERVAL` для очистки старых сообщений.

### USERS

Хранит Telegram-пользователей и ботов:

- id;
- username;
- first/last name;
- raw Telegram object;
- дополнительные Telegram-поля.

### USERS_CHATS

Связь пользователь/чат:

- `NEW_USER` — пользователь ещё не принял правила;
- `IS_BLOCKED` — пользователь заблокирован в логике бота.

### MESSAGES

Хранит сообщения:

- `MESSAGE_ID`;
- `CHAT_ID`;
- `USER_ID`;
- timestamp;
- `MESSAGE` как JSONB;
- `CTX` как JSONB.

Для `CTX` используется safe JSON serialization с защитой от circular references.

### AI_REQUEST

Хранит:

- запрос к AI;
- ответ AI;
- ошибку AI;
- timestamps;
- тип AI-запроса;
- модель.

### AI2CHAT_SETTINGS

Per-chat настройки AI:

- `SYSTEM_PROMPT`;
- `SUMMARY_PROMPT`;
- `TEST_SPAM_PROMPT`;
- `TEMPERATURE`;
- `MESSAGE_LIMIT`;
- и другие строковые настройки, которые может читать код.

## Логирование

Логгер находится в `common/logger.mjs`.

По умолчанию:

```text
./logs/log.txt
```

Перед запуском нужно создать каталог:

```bash
mkdir -p logs
```

Поддерживаются уровни:

- `err`;
- `warn`;
- `info`;
- `log`;
- `trace`;
- `trace1`;
- `trace2`;
- `dir`.

Текущий logger умеет простую файловую ротацию имени при открытии существующего log-файла: `log.txt`, `log.txt.1`, `log.txt.2` и так далее.

Сжатие gzip/zstd и удаление старых логов по возрасту/количеству в текущем коде ещё не реализованы.

## Обслуживание

### Автоочистка новых участников

Раз в минуту бот ищет пользователей с `NEW_USER=true`, которые не приняли правила более 3 часов, и банит их.

### Очистка истории сообщений

Раз в минуту бот читает `CHATS.CLEAR_INTERVAL` и удаляет из `MESSAGES` записи старше этого интервала.

Пример настройки:

```sql
UPDATE SYSADMIN_CHAT_BOT.CHATS
SET CLEAR_INTERVAL = INTERVAL '30 days'
WHERE ID = -1001234567890;
```

Если `CLEAR_INTERVAL` пустой, сообщения этого чата не чистятся.

## Безопасность

Практические правила:

- не публиковать `.env`;
- не хранить реальные API keys в README;
- SearXNG слушать только на `127.0.0.1`, если он нужен только боту;
- боту в Telegram давать только необходимые админские права;
- PostgreSQL-пользователю дать доступ только к базе бота;
- внимательно относиться к `internet_fetch_url`.

`internet_fetch_url` запрещает очевидные локальные адреса:

- `localhost`;
- `.localhost`;
- `.local`;
- `127.0.0.0/8`;
- `10.0.0.0/8`;
- `172.16.0.0/12`;
- `192.168.0.0/16`;
- `169.254.0.0/16`;
- `::1`.

Это базовая защита от SSRF, но не полноценный сетевой sandbox. Для продакшена желательно дополнительно проверять DNS-resolve результата и блокировать private IPv6/rfc1918 после резолва.

## Известные ограничения

- Нет автоматических тестов: `npm test` сейчас заглушка.
- Нет Dockerfile для самого бота.
- Нет миграционной системы БД; DDL лежит одним SQL-файлом.
- `AI_CHAT_MODEL` и параметры reasoning сейчас заданы в коде, а не через `.env`.
- Логгер простой: без gzip/zstd, без удаления по возрасту/количеству.
- `/set_ai_settings` зарегистрирован, но в текущем коде есть опечатка в regex очистки команды (`set_ai_settints` вместо `set_ai_settings`) и regex требует актуализации под `MESSAGE_LIMIT`.
- `internet_fetch_url` имеет базовые SSRF-фильтры, но не полноценную сетевую изоляцию.
- SearXNG как metasearch может зависеть от внешних поисковиков и иногда отдавать пустые/нестабильные результаты.

## Структура проекта

```text
.
├── .env.example              # пример переменных окружения
├── index.mjs                 # точка входа, Telegram handlers, запуск БД/бота/cleanup
├── package.json              # npm-зависимости и scripts
├── README.md                 # документация
├── SQL/
│   └── DDL.sql               # схема PostgreSQL
├── examples/
│   └── searxng/              # локальный SearXNG provider для internet_search
└── common/
    ├── ai_tools.mjs          # AI tools: date/time, URL fetch, search providers
    ├── db.mjs                # PostgreSQL pool
    ├── deepseek.mjs          # DeepSeek/OpenAI-compatible client, AI logic
    ├── logger.mjs            # файловый логгер
    ├── parser.mjs            # Markdown parser, tables, URL and Telegram entities splitter
    ├── telegram.mjs          # Telegram helpers and moderation helpers
    └── telegram_db.mjs       # SQL-запросы к БД
```

## Быстрая проверка после установки

```bash
mkdir -p logs
node --check index.mjs
node --check common/*.mjs
npm run run
```

В Telegram:

```text
/getchatid
/deepseek Привет. Какое сегодня число?
/deepseek_analyse Проверь, какие факты в этом сообщении требуют проверки по источникам.
/deepseek_summary 2h
```

Если включён SearXNG:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
```

Если бот стартует, но AI не отвечает, проверь:

- `DEEPSEEK_API_KEY`;
- доступ сервера к `https://api.deepseek.com`;
- таблицу `AI_REQUEST`;
- файл `logs/log.txt`;
- настройки `AI2CHAT_SETTINGS` для нужного `CHAT_ID`.
