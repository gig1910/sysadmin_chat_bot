CREATE SCHEMA IF NOT EXISTS SYSADMIN_CHAT_BOT;
SET SEARCH_PATH = SYSADMIN_CHAT_BOT, PUBLIC;

CREATE TABLE IF NOT EXISTS CHATS
(
    ID                    BIGINT PRIMARY KEY,
    TYPE                  TEXT NOT NULL,
    TITLE                 TEXT,
    INVITE_LINK           TEXT,
    PERMISSIONS           JSONB,
    JOIN_TO_SEND_MESSAGES BOOLEAN,
    MAX_REACTION_COUNT    INTEGER,
    RAW                   JSONB,
    CLEAR_INTERVAL        INTERVAL
);
COMMENT ON TABLE CHATS IS 'This table represents a chat.';
COMMENT ON COLUMN CHATS.ID IS 'Unique identifier for this chat. This number may have more than 32 significant bits and some programming languages may have difficulty/silent defects in interpreting it. But it has at most 52 significant bits, so a signed 64-bit integer or double-precision float type are safe for storing this identifier.';
COMMENT ON COLUMN CHATS.TYPE IS 'Type of the chat, can be either “private”, “group”, “supergroup” or “channel”';
COMMENT ON COLUMN CHATS.TITLE IS 'Optional. Title, for supergroups, channels and group chats';
COMMENT ON COLUMN CHATS.RAW IS 'RAW answer from telegram';
COMMENT ON COLUMN CHATS.CLEAR_INTERVAL IS 'Clear chat messages interval';

CREATE TABLE IF NOT EXISTS USERS
(
    ID                   BIGINT PRIMARY KEY,
    USERNAME             TEXT,
    FIRST_NAME           TEXT NOT NULL,
    LAST_NAME            TEXT,
    TYPE                 TEXT,
    ACTIVE_USERNAMES     TEXT[],
    BIO                  TEXT,
    HAS_PRIVATE_FORWARDS BOOLEAN,
    MAX_REACTION_COUNT   INTEGER,
    ACCENT_COLOR_ID      INTEGER,
    RAW                  JSONB
);
COMMENT ON TABLE USERS IS 'This table represents a Telegram user or bot.';
COMMENT ON COLUMN USERS.ID IS 'Unique identifier for this user or bot. This number may have more than 32 significant bits and some programming languages may have difficulty/silent defects in interpreting it. But it has at most 52 significant bits, so a 64-bit integer or double-precision float type are safe for storing this identifier.';
COMMENT ON COLUMN USERS.USERNAME IS 'Optional. User''s or bot''s username';
COMMENT ON COLUMN USERS.FIRST_NAME IS 'User''s or bot''s first name';
COMMENT ON COLUMN USERS.LAST_NAME IS 'Optional. User''s or bot''s last name';
COMMENT ON COLUMN USERS.RAW IS 'RAW answer from telegram';

CREATE TABLE IF NOT EXISTS USERS_CHATS
(
    USER_ID    BIGINT                NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    CHAT_ID    BIGINT                NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    NEW_USER   BOOLEAN DEFAULT TRUE  NOT NULL,
    IS_BLOCKED BOOLEAN DEFAULT FALSE NOT NULL,
    PRIMARY KEY (USER_ID, CHAT_ID)
);
COMMENT ON TABLE USERS_CHATS IS 'This table represents a Telegram user in chat.';
COMMENT ON COLUMN USERS_CHATS.USER_ID IS 'Unique identifier for this user or bot. This number may have more than 32 significant bits and some programming languages may have difficulty/silent defects in interpreting it. But it has at most 52 significant bits, so a 64-bit integer or double-precision float type are safe for storing this identifier.';
COMMENT ON COLUMN USERS_CHATS.CHAT_ID IS 'Unique identifier for this chat. This number may have more than 32 significant bits and some programming languages may have difficulty/silent defects in interpreting it. But it has at most 52 significant bits, so a signed 64-bit integer or double-precision float type are safe for storing this identifier.';
COMMENT ON COLUMN USERS_CHATS.NEW_USER IS 'True if user is new for this chats and not accepted chats rules';

CREATE TABLE IF NOT EXISTS MESSAGES
(
    MESSAGE_ID BIGINT,
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    TIMESTAMP  TIMESTAMP DEFAULT NOW() NOT NULL,
    MESSAGE    JSONB                   NOT NULL,
    CTX        JSONB,
    PRIMARY KEY (MESSAGE_ID, CHAT_ID)
);
CREATE INDEX IDX_MESSAGE_CTX ON MESSAGES USING GIN (CTX);

CREATE TABLE IF NOT EXISTS AIS
(
    ID      SERIAL PRIMARY KEY,
    NAME    TEXT NOT NULL,
    API_URL TEXT NOT NULL
);
INSERT INTO AIS (ID, NAME, API_URL)
VALUES (1, 'deepseek', 'https://api.deepseek.com'),
       (2, 'openai', 'https://api.openai.com'),
       (3, 'groq', 'https://api.groq.com')
ON CONFLICT DO NOTHING;

CREATE TABLE AI_KINDS
(
    ID    SMALLSERIAL PRIMARY KEY,
    NAME  TEXT NOT NULL,
    DESCR TEXT
);
INSERT INTO AI_KINDS (ID, NAME, DESCR)
VALUES (1, 'is_spam', 'Проверка сообщения на SPAM'),
       (2, 'message', 'Сообщение'),
       (3, 'test_message', 'Тестовое сообщение'),
       (4, 'summary', 'Краткая сводка по всем сообщениям за интервал')
ON CONFLICT DO NOTHING;

CREATE TABLE AI_MODELS
(
    ID   SMALLSERIAL PRIMARY KEY,
    NAME TEXT NOT NULL
);
INSERT INTO SYSADMIN_CHAT_BOT.AI_MODELS (ID, NAME)
VALUES (1, 'deepseek-reasoner'),
       (2, 'deepseek-chat')
ON CONFLICT DO NOTHING;

CREATE TABLE AI_REQUEST
(
    ID                SERIAL PRIMARY KEY,
    REQUEST_TIMESTAMP TIMESTAMP DEFAULT NOW() NOT NULL,
    REQUEST           JSONB,
    ANSWER_TIMESTAMP  TIMESTAMP,
    ANSWER            JSONB,
    AI_ID             INT                     NOT NULL REFERENCES AIS ON UPDATE CASCADE ON DELETE CASCADE,
    AI_KIND           SMALLINT                NOT NULL REFERENCES AI_KINDS,
    AI_MODEL          SMALLINT                NOT NULL REFERENCES AI_MODELS,
    ERROR             JSONB,
    ERROR_TIMESTAMP   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AI2CHAT_SETTINGS
(
    CHAT_ID       BIGINT NOT NULL REFERENCES CHATS ON DELETE CASCADE ON UPDATE CASCADE,
    AI_ID         INT    NOT NULL REFERENCES AIS ON DELETE CASCADE ON UPDATE CASCADE,
    TYPE          TEXT   NOT NULL,
    REASONER_MODE BOOL DEFAULT FALSE,
    VALUE         TEXT   NOT NULL,
    PRIMARY KEY (CHAT_ID, AI_ID, TYPE, REASONER_MODE)
);
INSERT INTO AI2CHAT_SETTINGS (CHAT_ID, AI_ID, TYPE, REASONER_MODE, VALUE)
VALUES (-1003676689309, 1, 'SYSTEM_PROMPT', FALSE, 'Это чат-диалог. Твоя роль: поддержка беседы и ответы на вопросы, заданные именно тебе. Будь минимально вежливым. В вежливости нет истины. Но быть максимально корректным с логической и ' ||
                                                   'фактологической ' ||
                                                   'стороны. В ответе используй разметку MarkDown, но, по возможности, старайся не отвечать более 4000 символов (требование не жёсткое, а рекомендация).'),
       (-1003676689309, 1, 'SYSTEM_PROMPT', TRUE,
        'Это чат-диалог с анализом. Твоя роль: эксперт. Твоя задача: анализ беседы и ответы на вопросы, заданные именно тебе. Будь минимально вежливым. В вежливости нет истины. Но быть максимально корректным с ' ||
        'логической и фактологической стороны. В ответе используй разметку MarkDown, но, по возможности, старайся не отвечать более 4000 символов (требование не жёсткое, а рекомендация).'),
       (-1003676689309, 1, 'TEMPERATURE', FALSE, '1.5'),
       (-1003676689309, 1, 'TEMPERATURE', TRUE, '1.2')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS USER_MEMORY
(
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON DELETE CASCADE ON UPDATE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON DELETE CASCADE ON UPDATE CASCADE,
    DATA_ENC   JSONB                   NOT NULL,
    VERSION    INTEGER   DEFAULT 1     NOT NULL,
    ENABLED    BOOLEAN   DEFAULT TRUE  NOT NULL,
    CREATED_AT TIMESTAMP DEFAULT NOW() NOT NULL,
    UPDATED_AT TIMESTAMP DEFAULT NOW() NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID)
);
COMMENT ON TABLE USER_MEMORY IS 'Encrypted opaque user memory JSON envelope by chat-user pair. Plaintext is never indexed or searched.';

CREATE TABLE IF NOT EXISTS USER_CHARACTERISTICS
(
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON DELETE CASCADE ON UPDATE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON DELETE CASCADE ON UPDATE CASCADE,
    DATA_ENC   JSONB                   NOT NULL,
    VERSION    INTEGER   DEFAULT 1     NOT NULL,
    ENABLED    BOOLEAN   DEFAULT TRUE  NOT NULL,
    CREATED_AT TIMESTAMP DEFAULT NOW() NOT NULL,
    UPDATED_AT TIMESTAMP DEFAULT NOW() NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID)
);
COMMENT ON TABLE USER_CHARACTERISTICS IS 'Encrypted opaque cumulative user characteristics JSON envelope by chat-user pair. Plaintext is never indexed or searched.';

CREATE TABLE IF NOT EXISTS USER_MEMORY_RECALC_QUEUE
(
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON DELETE CASCADE ON UPDATE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON DELETE CASCADE ON UPDATE CASCADE,
    KIND       TEXT                    NOT NULL CHECK (KIND IN ('memory', 'characteristics')),
    REASON     TEXT                    NOT NULL,
    PRIORITY   INTEGER   DEFAULT 100   NOT NULL,
    NOT_BEFORE TIMESTAMP DEFAULT NOW() NOT NULL,
    ATTEMPTS   INTEGER   DEFAULT 0     NOT NULL,
    LOCKED_AT  TIMESTAMP,
    DONE_AT    TIMESTAMP,
    UPDATED_AT TIMESTAMP DEFAULT NOW() NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID, KIND)
);
COMMENT ON TABLE USER_MEMORY_RECALC_QUEUE IS 'Background queue for encrypted user memory/characteristics recalculation.';
