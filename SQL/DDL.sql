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
CREATE INDEX IDX_MESSAGE_CTX ON MESSAGES USING GIN(CTX);

CREATE TABLE IF NOT EXISTS CHATS_USERS_TEST_QUESTION
(
    CHAT_ID BIGINT NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID BIGINT NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    ANSWER  TEXT   NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID)
);
