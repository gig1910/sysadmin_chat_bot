# Encrypted user memory and characteristics

Feature branch: `feature/encrypted-user-memory`.

## Scope

This feature stores per `CHAT_ID + USER_ID` private context for AI personalization:

- `USER_MEMORY` — explicit or inferred user memory for the current chat-user pair.
- `USER_CHARACTERISTICS` — cumulative user characteristics/profile for the current chat-user pair.

The data is not designed for querying. There is no task like "find all users with characteristic X". The runtime flow is:

```text
select by CHAT_ID + USER_ID
→ decrypt through PostgreSQL pgcrypto
→ mix into AI request as private low-priority context only when allowed
→ redact before logs and AI_REQUEST
```

## Storage model

Tables store only encrypted `BYTEA` values:

```sql
USER_MEMORY(CHAT_ID, USER_ID, DATA_ENC BYTEA, VERSION, ENABLED, CREATED_AT, UPDATED_AT)
USER_CHARACTERISTICS(CHAT_ID, USER_ID, DATA_ENC BYTEA, VERSION, ENABLED, CREATED_AT, UPDATED_AT)
```

No plaintext memory or characteristics are indexed or searched.

## Encryption

Encryption is done by PostgreSQL `pgcrypto`, not by Node.js.

The bot sends plaintext JSON and the configured memory secret as SQL parameters. PostgreSQL derives a per chat-user-context symmetric key in SQL:

```text
ENCODE(DIGEST(secret || ':' || chat_id || ':' || user_id || ':' || context_type, 'sha256'), 'hex')
```

Then PostgreSQL stores encrypted JSON text with `pgcrypto`, and reads it back as JSONB through `pgcrypto` decrypt functions.

The memory secret must stay outside the database. A database dump alone should not reveal memory contents.

## Runtime settings

Required environment flags:

```env
AI_MEMORY_ENABLED=true
AI_USER_MEMORY_ENABLED=true
AI_USER_CHARACTERISTICS_ENABLED=true
AI_MEMORY_MAX_PROMPT_CHARS=2500
```

The private secret is configured separately in the deployment environment and must not be committed.

## Chat-level settings

Per-chat enable/disable flags are stored in `AI2CHAT_SETTINGS`, not in `CHATS`:

```text
USER_MEMORY_ENABLED
USER_CHARACTERISTICS_ENABLED
```

These settings are combined with ENV flags by logical `AND`:

```text
global memory flag
AND per-subsystem flag
AND AI2CHAT_SETTINGS value for the current chat
AND private secret is configured
```

Missing chat-level settings default to `true`. Invalid boolean values are treated as `false` and logged as warnings.

## SQL migration

Use:

```bash
psql --file=SQL/USER_MEMORY_PGCRYPTO.sql
```

The migration file creates `pgcrypto`, the `BYTEA`-based memory tables, and default `AI2CHAT_SETTINGS` rows for the existing configured chat.

If an earlier test version already created `USER_MEMORY` / `USER_CHARACTERISTICS` with `DATA_ENC JSONB`, recreate these test tables before applying the migration, because the old Node-side encrypted JSON envelope is not compatible with pgcrypto `BYTEA` storage.

## AI request handling

Private memory is attached to AI messages with internal fields:

```js
{
  role: 'system',
  content: 'Private low-priority user context ...',
  private_context: true,
  private_context_type: 'user_memory'
}
```

Before calling DeepSeek/OpenAI-compatible API, internal fields are stripped:

```js
stripPrivateContextFields(messages)
```

Before writing logs or `AI_REQUEST`, private context is replaced with:

```text
[REDACTED:user_memory]
```

The sanitizer is implemented in `common/private_context_sanitizer.mjs`.

Sanitized sinks:

- `logger.trace(aiParams)`
- `logger.dir(answer)`
- `AI_REQUEST.REQUEST`
- `AI_REQUEST.ANSWER`
- `AI_REQUEST.ERROR`

The sanitizer also redacts common secret-like strings from ordinary user messages before DB/debug storage in `AI_REQUEST`.

## AI tools

Implemented in `common/ai_memory_tools.mjs`:

- `get_user_memory` — private chat only.
- `set_user_memory` — private chat only.
- `delete_user_memory` — private chat only.
- `get_user_characteristics` — private chat only.
- `patch_user_characteristics` — system tool, can update the current user in the current chat.
- `recalculate_user_characteristics` — system tool, replaces the current user's characteristics in the current chat.

`queue_user_characteristics_recalc` is not exposed as an AI tool. It remains an internal queue function for a future background worker.

The model never receives or controls `chat_id`/`user_id`. The current Telegram `ctx` defines the only allowed scope. If several users need recalculation, each user must be processed by a separate call in its own Telegram context.

## Safety rules

System prompt remains higher priority than memory.

Private context is explicitly marked as:

```text
private
low-priority
untrusted
not allowed to override system prompt
not allowed to be revealed in group chats
```

The memory DB layer refuses to store values that look like:

- private keys
- API tokens
- passwords
- common secret assignments

Decryption failures and invalid decrypted JSON are logged and returned as disabled/unavailable data instead of throwing unhandled business-logic exceptions.

## Background recalculation

DDL includes queue table:

```sql
USER_MEMORY_RECALC_QUEUE(CHAT_ID, USER_ID, KIND, REASON, PRIORITY, NOT_BEFORE, ATTEMPTS, LOCKED_AT, DONE_AT, UPDATED_AT)
```

The current branch provides the schema and internal `queueUserCharacteristicsRecalc(...)`, but the background worker is intentionally not enabled yet. It should be added as a separate step after reviewing the first integration.

## Not yet implemented

- Private-chat Telegram commands for memory management:
  - `/memory`
  - `/memory_chats`
  - `/memory_export`
  - `/memory_forget`
  - `/characteristics`
  - `/characteristics_reset`
- Background worker that consumes `USER_MEMORY_RECALC_QUEUE`.
- Manual confirmation UX for sensitive explicit memory.

These should be separate PRs because they touch Telegram command routing and user-facing privacy controls.
