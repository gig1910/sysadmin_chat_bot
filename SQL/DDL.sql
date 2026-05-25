-- auto-generated definition
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
    RAW                   JSONB
);
COMMENT ON TABLE CHATS IS 'This table represents a chat.';
COMMENT ON COLUMN CHATS.ID IS 'Unique identifier for this chat. This number may have more than 32 significant bits and some programming languages may have difficulty/silent defects in interpreting it. But it has at most 52 significant bits, so a signed 64-bit integer or double-precision float type are safe for storing this identifier.';
COMMENT ON COLUMN CHATS.TYPE IS 'Type of the chat, can be either “private”, “group”, “supergroup” or “channel”';
COMMENT ON COLUMN CHATS.TITLE IS 'Optional. Title, for supergroups, channels and group chats';
COMMENT ON COLUMN CHATS.RAW IS 'RAW answer from telegram';

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

CREATE TABLE IF NOT EXISTS FINES
(
    ID          SERIAL PRIMARY KEY,
    NAME        TEXT NOT NULL,
    DESCRIPTION TEXT
);
COMMENT ON TABLE FINES IS 'This table represents a user fines types';
COMMENT ON COLUMN FINES.ID IS 'Fines description.';
INSERT INTO FINES(NAME, DESCRIPTION)
VALUES ('SPAM', 'Detect SPAM messages');

CREATE TABLE IF NOT EXISTS USER_FINES
(
    USER_ID     BIGINT                  NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    CHAT_ID     BIGINT                  NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    TIMESTAMP   TIMESTAMP DEFAULT NOW() NOT NULL,
    TYPE        INTEGER                 NOT NULL REFERENCES FINES ON UPDATE CASCADE ON DELETE CASCADE,
    DESCRIPTION TEXT,
    PRIMARY KEY (USER_ID, CHAT_ID, TIMESTAMP, TYPE)
);
CREATE INDEX IDX_USER_FINES_USER_ID_CHAT_ID_TIMESTAMP ON USER_FINES (USER_ID, CHAT_ID, TIMESTAMP);

CREATE TABLE IF NOT EXISTS ACTIONS
(
    ACTION      TEXT PRIMARY KEY,
    DESCRIPTION TEXT
);

CREATE TABLE IF NOT EXISTS COMMANDS
(
    COMMAND     TEXT PRIMARY KEY,
    DESCRIPTION TEXT
);

CREATE TABLE IF NOT EXISTS MESSAGES
(
    MESSAGE_ID BIGINT PRIMARY KEY,
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    TIMESTAMP  TIMESTAMP DEFAULT NOW() NOT NULL,
    MESSAGE    JSONB                   NOT NULL,
    CTX        JSONB
);
CREATE INDEX IDX_MESSAGE_CTX ON MESSAGES USING GIN (CTX);

CREATE TABLE IF NOT EXISTS CHATS_USERS_TEST_QUESTION
(
    CHAT_ID BIGINT NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID BIGINT NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    ANSWER  TEXT   NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID)
);

CREATE TABLE IF NOT EXISTS AIS
(
    ID    SERIAL PRIMARY KEY,
    NAME  TEXT NOT NULL UNIQUE,
    DESCR TEXT
);
INSERT INTO AIS (NAME, DESCR)
VALUES ('deepseek', 'DeepSeek'),
       ('openAI', 'OpenAI'),
       ('groq', 'Groq')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS AI_KINDS
(
    ID    SMALLSERIAL PRIMARY KEY,
    NAME  TEXT NOT NULL UNIQUE,
    DESCR TEXT
);
INSERT INTO AI_KINDS (ID, NAME, DESCR)
VALUES (1, 'is_spam', 'Проверка сообщения на SPAM'),
       (2, 'message', 'Сообщение'),
       (3, 'test_message', 'Тестовое сообщение')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS AI_MODELS
(
    ID   SMALLSERIAL PRIMARY KEY,
    NAME TEXT NOT NULL UNIQUE,
    AI   INT  NOT NULL REFERENCES AIS ON UPDATE CASCADE ON DELETE SET NULL
);
INSERT INTO AI_MODELS (NAME, AI)
VALUES ('deepseek-reasoner', 1),
       ('deepseek-chat', 1),
       ('gpt-5.4-nano', 2),
       ('deepseek-v4-flash', 1),
       ('deepseek-v4-pro', 1),
       ('groq/compound', 3)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS AI_REQUEST
(
    ID                SERIAL PRIMARY KEY,
    REQUEST_TIMESTAMP TIMESTAMP DEFAULT NOW() NOT NULL,
    REQUEST           JSONB,
    ANSWER_TIMESTAMP  TIMESTAMP,
    ANSWER            JSONB,
    AI                INT                     NOT NULL REFERENCES AIS ON UPDATE CASCADE ON DELETE SET NULL,
    AI_KIND           SMALLINT                NOT NULL REFERENCES AI_KINDS,
    AI_MODEL          SMALLINT                NOT NULL REFERENCES AI_MODELS,
    ERROR             JSONB,
    ERROR_TIMESTAMP   TIMESTAMP,
    USER_ID           BIGINT                  REFERENCES USERS ON UPDATE CASCADE ON DELETE SET NULL,
    CHAT_ID           BIGINT                  REFERENCES CHATS ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS CHAT_IS_SETTINGS
(
    CHAT_ID  BIGINT REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
    AI_ID    INT REFERENCES AIS ON UPDATE CASCADE ON DELETE CASCADE      NOT NULL,
    SETTINGS JSONB,
    PRIMARY KEY (CHAT_ID, AI_ID)
);