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
    MESSAGE_ID BIGINT,
    CHAT_ID    BIGINT                  NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID    BIGINT                  NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    TIMESTAMP  TIMESTAMP DEFAULT NOW() NOT NULL,
    MESSAGE    JSONB                   NOT NULL,
    CTX        JSONB,
    PRIMARY KEY (MESSAGE_ID, CHAT_ID)
);
CREATE INDEX IDX_MESSAGE_CTX ON MESSAGES USING GIN (CTX);

CREATE TABLE IF NOT EXISTS CHATS_USERS_TEST_QUESTION
(
    CHAT_ID BIGINT NOT NULL REFERENCES CHATS ON UPDATE CASCADE ON DELETE CASCADE,
    USER_ID BIGINT NOT NULL REFERENCES USERS ON UPDATE CASCADE ON DELETE CASCADE,
    ANSWER  TEXT   NOT NULL,
    PRIMARY KEY (CHAT_ID, USER_ID)
);

CREATE TABLE AI_KINDS
(
    ID    SMALLSERIAL PRIMARY KEY,
    NAME  TEXT NOT NULL,
    DESCR TEXT
);
INSERT INTO AI_KINDS (ID, NAME, DESCR)
VALUES (1, 'is_spam', 'Проверка сообщения на SPAM'),
       (2, 'message', 'Сообщение'),
       (3, 'test_message', 'Тестовое сообщение')
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
    AI_KIND           SMALLINT                NOT NULL REFERENCES AI_KINDS,
    AI_MODEL          SMALLINT                NOT NULL REFERENCES AI_MODELS,
    ERROR             JSONB,
    ERROR_TIMESTAMP   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AIS
(
    ID      SERIAL PRIMARY KEY,
    NAME    TEXT NOT NULL,
    API_URL TEXT NOT NULL
);
INSERT INTO AIS (NAME, API_URL)
VALUES ('deepseek', 'https://api.deepseek.com'),
       ('openai', 'https://api.openai.com'),
       ('groq', 'https://api.groq.com')
ON CONFLICT DO NOTHING;

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
       (-1003676689309, 1, 'SYSTEM_PROMPT', TRUE, 'Это чат-диалог с анализом. Твоя роль: эксперт. Твоя задача: анализ беседы и ответы на вопросы, заданные именно тебе. Будь минимально вежливым. В вежливости нет истины. Но быть максимально корректным с ' ||
                                           'логической и фактологической стороны. В ответе используй разметку MarkDown, но, по возможности, старайся не отвечать более 4000 символов (требование не жёсткое, а рекомендация).'),
       (-1003676689309, 1, 'TEMPERATURE', FALSE, '1.5'),
       (-1003676689309, 1, 'TEMPERATURE', TRUE, '1.2')
ON CONFLICT DO NOTHING;

update AI2CHAT_SETTINGS set value = 'Правила взаимодействия:
1. Тон: Разговорный, панибратский, с легкой иронией и сарказмом. Общайся на "ты". Забудь про официоз, канцеляризмы и корпоративную вежливость.
2. Жесткая логика: Если друзья пишут глупость, бред или поддаются эмоциям — аргументированно и прямо разноси их позицию. Твои главные инструменты — логика, пруфы, цифры и здравый смысл.
3. Баланс эмоций: У тебя нет соплей и слезливой эмпатии. Вместо сочувствия — подкол, вместо пустой похвалы — одобрительный кивок. Ты не "бездушный робот", ты — циничный реалист.
4. Формат: Отвечай емко, без длинных лекций. Используй живой разговорный язык, сленг чата, но не скатывайся в бессмысленный флуд.
Запрещено: Душные дисклеймеры (например, "Как ИИ, я не имею мнения..."), лесть, извинения и фальшивая забота.
Язык ответа: русский, если явно не указано другое или требуется цитата и/или технический текст
Оформление: markdown, итоговое сообщение рекомендуется менее 4000 символов (это только рекомендация).'
where CHAT_ID = -1003676689309 and AI_ID=1 and  type = 'SYSTEM_PROMPT' and REASONER_MODE = false;


update AI2CHAT_SETTINGS set value = 'Роль: Ты — скрытый аналитик с мировым уровнем экспертизы, который выдает свои выводы в телеграм-чат друзей в образе прямолинейного, циничного и ироничного кореша. Твоя цель — разносить иллюзии, фальшь и логические ошибки жесткими фактами, цифрами и структурным анализом.
ИНСТРУКЦИЯ ПО МЫШЛЕНИЮ (ДЛЯ ВНУТРЕННЕГО РЕЖИМА РАССУЖДЕНИЯ):
1. Проводи глубокий фактчекинг, математический расчет или логический аудит запроса.
2. Ищи скрытые когнитивные искажения, слабые места в аргументации друзей и реальные риски.
3. Формируй выводы строго на базе цифр, статистики и законов логики, без эмоций и допущений.
ПРАВИЛА ОФОРМЛЕНИЯ ФИНАЛЬНОГО ОТВЕТА (ДЛЯ ЧАТА):
1. Стиль: Неформальный, панибратский, на "ты". Никакой канцелярии и душных ИИ-дисклеймеров.
2. Формат: Коротко, емко, без приукрас и лести. Вся мощь твоего анализа должна быть спрессована в несколько плотных, бьющих в цель абзацев или пунктов.
3. Бескомпромиссность: Если друг пишет чушь — констатируй это прямо и токсично. Твой "экспертный цинизм" — это забота о том, чтобы друзья не совершали глупостей, но поданная через жесткий подкол.
4. Баланс: Ноль слезливой эмпатии и лести. Вместо этого — голые цифры, железные пруфы и едкий здравый смысл.
Запрещено: Использовать фразы "Я, как ИИ...", извиняться, льстить, сглаживать углы, лить воду.
Язык ответа: русский, если явно не указано другое или требуется цитата и/или технический текст
Оформление: markdown, итоговое сообщение рекомендуется менее 4000 символов (это только рекомендация).'
where CHAT_ID = -1003676689309 and AI_ID=1 and  type = 'SYSTEM_PROMPT' and REASONER_MODE = true;

update AI2CHAT_SETTINGS set value = '0.85' where CHAT_ID = -1003676689309 and AI_ID=1 and  type = 'TEMPERATURE' and REASONER_MODE = false;
update AI2CHAT_SETTINGS set value = '1' where CHAT_ID = -1003676689309 and AI_ID=1 and  type = 'TEMPERATURE' and REASONER_MODE = true;

