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
- [Модерация новых участников](#модерация-новых-участников)
- [AI-режимы](#ai-режимы)
- [AI tools и интернет-доступ](#ai-tools-и-интернет-доступ)
- [SearXNG](#searxng)
- [Хранение данных](#хранение-данных)
- [Логирование](#логирование)
- [Markdown и длинные ответы](#markdown-и-длинные-ответы)
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
- разбивает длинные Telegram-сообщения на части;
- конвертирует Markdown в Telegram entities;
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
common/deepseek.mjs        — AI-запросы, спам, диалоги, summary
common/ai_tools.mjs        — tools для AI: дата, URL, поиск, GitHub, Wikipedia, StackExchange
common/parser.mjs          — Markdown → Telegram entities, разбиение длинных сообщений
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

Для текущей ветки с AI tools:

```bash
git fetch origin feature/ai-tools-date-internet
git checkout feature/ai-tools-date-internet
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

Минимальный пример:

```env
# Telegram
TOKEN=123456789:telegram_bot_token
TELEGRAM_MAX_MESSAGE_LENGTH=4000
TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE=10000
TELEGRAM_TIMEOUT_TO_DELETE_QUESTION=60000

# PostgreSQL
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=sysadmin_chat_bot
DB_USER=sysadmin_chat_bot
DB_PASS=change_me

# DeepSeek
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx

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
```

Отправляет приветствие.

```text
/help
```

Отправляет короткое описание бота.

```text
/getchatid
```

Показывает `userID` и `chatID`. Удобно для настройки БД.

```text
/question
```

Отправляет памятку о том, как правильно задавать технический вопрос.

### AI-команды

```text
/deepseek <вопрос>
```

Обычный AI-ответ.

```text
/deepseek_analyse <вопрос>
```

AI-ответ в режиме анализа. В текущем коде включаются дополнительные параметры `thinking` и `reasoning_effort`.

```text
/deepseek_summary 2h
/deepseek_summary 30m
/deepseek_summary 1d
/deepseek_summary 2h что изменилось по теме PostgreSQL?
```

Сводка сообщений за интервал. Поддерживаются суффиксы:

- `m` — минуты;
- `h` — часы;
- `d` — дни.

Если интервал не указан, используется `2h`.

```text
/deepseek_test_spam <текст>
```

Проверяет текст через AI как спам/не спам и возвращает `YES` или `NO`.

### Админ-команды AI-настроек

```text
/get_ai_settings
```

Показывает AI-настройки для текущего чата: отдельно обычный режим и режим анализа.

```text
/set_ai_settings <true|false> <TYPE> <VALUE>
```

Задуманный формат:

```text
/set_ai_settings false SYSTEM_PROMPT Ты помощник в техническом чате.
/set_ai_settings true TEMPERATURE 1.0
/set_ai_settings false MESSAGE_LIMIT 30
```

Где первый параметр:

- `false` — обычный режим;
- `true` — режим анализа.

Команда доступна только администраторам группы.

Текущий известный дефект: в обработчике очистки текста команды есть опечатка в регулярном выражении (`set_ai_settints` вместо `set_ai_settings`). Перед активным использованием команды это нужно исправить в `index.mjs`.

## Модерация новых участников

Когда в группу входит новый участник:

1. бот сохраняет чат и пользователя в БД;
2. создаёт запись в `USERS_CHATS` с `NEW_USER=true`;
3. отправляет приветствие с inline-кнопками;
4. настоящая кнопка `Принимаю правила` помещается в случайную позицию среди вариантов;
5. сообщение с вопросом удаляется через `TELEGRAM_TIMEOUT_TO_DELETE_QUESTION`.

Если пользователь нажал `Принимаю правила`:

- бот сбрасывает `NEW_USER=false`;
- отправляет временное подтверждение.

Если пользователь нажал неверную кнопку:

- бот отвечает callback-уведомлением `Неверный ответ.`.

Если новый пользователь пишет сообщение до принятия правил:

- бот удаляет сообщение;
- если это текст — отправляет его на AI-проверку спама;
- если AI вернул `YES`, бот банит пользователя;
- если это не текст, бот считает это спам-поведением и банит пользователя.

Периодический обработчик раз в минуту ищет новых пользователей, которые не приняли правила более 3 часов, и банит их.

## AI-режимы

### Обычный диалог

В личных сообщениях бот автоматически отправляет текст в DeepSeek.

В группе бот отвечает только если:

- пользователь отвечает на приветственное сообщение AI-помощника;
- пользователь отвечает на цепочку сообщений, где уже был `/deepseek`;
- используется команда `/deepseek` или `/deepseek_analyse`.

История диалога строится рекурсивно по `reply_to_message.message_id` из таблицы `MESSAGES`. По умолчанию берётся до 20 сообщений, либо значение из настройки `MESSAGE_LIMIT`.

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

Общие параметры:

```env
AI_SEARCH_TIMEOUT_MS=15000
AI_FETCH_TIMEOUT_MS=20000
AI_CONFIG_CHECK_TIMEOUT_MS=5000
AI_SEARCH_MAX_RESULTS=8
AI_FETCH_MAX_CHARS=30000
AI_MAX_TOOL_ROUNDS=3
```

`AI_MAX_TOOL_ROUNDS` ограничивает количество последовательных tool-calls, чтобы модель не ушла в бесконечный цикл.

### Общий поиск `internet_search`

`internet_search` не привязан к конкретному API. Модель вызывает только общий tool, а код внутри выбирает provider.

Один provider:

```env
AI_SEARCH_PROVIDER=searxng
```

Цепочка fallback-провайдеров:

```env
AI_SEARCH_PROVIDERS=searxng,brave
```

Поддержанные provider names:

- `searxng`;
- `brave`;
- `none`, `off`, `false`, `disabled`, `disable`, `0` — отключить общий поиск.

Если общий поиск не нужен, но нужны специализированные tools:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=none
```

### Brave provider

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=xxxxxxxxxxxxxxxx
```

Brave оставлен как опциональный fallback, но для маленькой группы обычно дешевле и практичнее использовать SearXNG.

### GitHub search

Опционально можно задать token:

```env
GITHUB_SEARCH_TOKEN=github_pat_xxxxxxxxxxxxxxxx
```

Без token GitHub API тоже может работать, но с меньшими лимитами и ограничениями.

## SearXNG

Рекомендуемый бесплатный provider общего поиска.

Минимальный `docker-compose.yml`:

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    ports:
      - "127.0.0.1:8888:8080"
    volumes:
      - ./searxng:/etc/searxng
    environment:
      - BASE_URL=http://127.0.0.1:8888/
      - INSTANCE_NAME=sysadmin-chat-search
```

Запуск:

```bash
docker compose up -d
```

Проверка:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
```

`.env` для бота:

```env
AI_ALLOW_INTERNET=true
AI_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://127.0.0.1:8888
```

Опционально, если перед SearXNG стоит reverse-proxy с Bearer auth:

```env
SEARXNG_API_KEY=xxxxxxxxxxxxxxxx
```

### Startup check SearXNG

При старте бот вызывает `checkAIToolsConfig()` перед `telegram.bot.launch()`.

Если включён `searxng`, бот проверяет:

```bash
curl 'http://127.0.0.1:8888/search?q=searxng&format=json'
```

Проверяется:

- задан ли `SEARXNG_URL`;
- отвечает ли endpoint;
- вернулся ли JSON;
- есть ли в JSON поле `results[]`.

Если проверка не прошла, бот пишет warning со справкой в лог, но не падает. Остальные функции продолжают работать.

Если SearXNG возвращает HTML или ошибку вместо JSON, нужно проверить, что JSON output разрешён в настройках SearXNG.

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

## Markdown и длинные ответы

Telegram имеет ограничение размера сообщения. В проекте используется `common/parser.mjs`, который:

- парсит Markdown через `markdown-it`;
- конвертирует оформление в Telegram entities;
- поддерживает inline code, code fences, bold, italic, underline, strikethrough, links, blockquote;
- разбивает длинный ответ на части до `TELEGRAM_MAX_MESSAGE_LENGTH`;
- старается сохранять корректные offsets entities после разбиения.

Для обычного текста без Markdown используется простое разбиение по `TELEGRAM_MAX_MESSAGE_LENGTH`.

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
- `/set_ai_settings` зарегистрирован, но в текущем коде есть опечатка в regex очистки команды (`set_ai_settints` вместо `set_ai_settings`). Перед использованием команды нужно поправить `index.mjs`.
- `internet_fetch_url` имеет базовые SSRF-фильтры, но не полноценную сетевую изоляцию.
- SearXNG как metasearch может зависеть от внешних поисковиков и иногда отдавать пустые/нестабильные результаты.

## Структура проекта

```text
.
├── index.mjs                  # точка входа, Telegram handlers, запуск БД/бота/cleanup
├── package.json               # npm-зависимости и scripts
├── README.md                  # документация
├── SQL/
│   └── DDL.sql                # схема PostgreSQL
└── common/
    ├── ai_tools.mjs           # AI tools: date/time, URL fetch, search providers
    ├── db.mjs                 # PostgreSQL pool
    ├── deepseek.mjs           # DeepSeek/OpenAI-compatible client, AI logic
    ├── logger.mjs             # файловый логгер
    ├── parser.mjs             # Markdown parser and Telegram entities splitter
    ├── telegram.mjs           # Telegram helpers and moderation helpers
    └── telegram_db.mjs        # SQL-запросы к БД
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
