# Encrypted user memory and characteristics

Feature branch: `feature/encrypted-user-memory`.

## Scope

This feature stores per `CHAT_ID + USER_ID` private context for AI personalization:

- `USER_MEMORY` — explicit or inferred user memory for the current chat-user pair.
- `USER_CHARACTERISTICS` — cumulative user characteristics/profile for the current chat-user pair.

The data is not designed for querying. There is no task like "find all users with characteristic X". The only runtime flow is:

```text
select by CHAT_ID + USER_ID
→ decrypt in bot RAM
→ mix into AI request as private low-priority context
→ redact before logs and AI_REQUEST
```

## Storage model

Tables store only encrypted opaque JSON envelopes:

```sql
USER_MEMORY(CHAT_ID, USER_ID, DATA_ENC JSONB, VERSION, ENABLED, CREATED_AT, UPDATED_AT)
USER_CHARACTERISTICS(CHAT_ID, USER_ID, DATA_ENC JSONB, VERSION, ENABLED, CREATED_AT, UPDATED_AT)
```

`DATA_ENC` format:

```json
{
  "v": 1,
  "alg": "AES-256-GCM",
  "kid": "memory-key-v1",
  "iv": "base64",
  "tag": "base64",
  "data": "base64"
}
```

No plaintext memory or characteristics are indexed or searched.

## Encryption

Implemented in `common/private_crypto.mjs`.

Key derivation:

```text
HKDF-SHA256(master_key, salt, info = context_type:chat_id:user_id, length = 32)
```

Recommended key generation:

```bash
openssl rand -base64 32
```

`.env`:

```env
AI_MEMORY_ENABLED=true
AI_MEMORY_MASTER_KEY=
AI_MEMORY_KEY_ID=memory-key-v1
AI_MEMORY_MAX_PROMPT_CHARS=2500
```

`AI_MEMORY_MASTER_KEY` must stay outside the database. A database dump alone should not reveal memory contents.

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

- `get_user_memory`
- `set_user_memory`
- `delete_user_memory`
- `get_user_characteristics`
- `patch_user_characteristics`
- `queue_user_characteristics_recalc`

The model never receives or controls `chat_id`/`user_id`. The current Telegram `ctx` defines the only allowed scope.

Memory tools are registered only when:

```env
AI_MEMORY_ENABLED=true
AI_MEMORY_MASTER_KEY=...
```

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

## Background recalculation

DDL includes queue table:

```sql
USER_MEMORY_RECALC_QUEUE(CHAT_ID, USER_ID, KIND, REASON, PRIORITY, NOT_BEFORE, ATTEMPTS, LOCKED_AT, DONE_AT, UPDATED_AT)
```

The current branch provides the schema and `queue_user_characteristics_recalc` tool, but the background worker is intentionally not enabled yet. It should be added as a separate step after reviewing the first integration.

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
