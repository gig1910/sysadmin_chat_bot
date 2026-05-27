import {stringify}   from 'flatted';
import * as db       from './db.mjs';
import * as telegram from './telegram.mjs';

//-----------------------------------


/**
 * @typedef Chat
 * @property id {Number}
 * @property type {String
 * @property title {String}
 * @property invite_link {String}
 * @property permissions {Object}
 * @property join_to_send_messages {Boolean}
 * @property max_reaction_count {Number}
 */

/**
 * @typedef User
 * @property id {Number}
 * @property username {String}
 * @property first_name {String}
 * @property last_name {String}
 * @property type {String}
 * @property active_usernames {[String]}
 * @property bio {String}
 * @property has_private_forwards {Boolean}
 * @property max_reaction_count {Number}
 * @property accent_color_id: {Number}
 */

/**
 * Добавление нового чата в БД
 * @param {Object|Chat} chat
 * @returns {Promise<*>}
 */
export const addChat2DB = async chat => db.query(`
            INSERT INTO CHATS(ID, TYPE, TITLE, INVITE_LINK, PERMISSIONS, JOIN_TO_SEND_MESSAGES, MAX_REACTION_COUNT, RAW)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::TEXT, $5::JSONB, $6::BOOL, $7::INT, $8::JSONB)
            ON CONFLICT(ID) DO UPDATE SET TYPE=EXCLUDED.TYPE,
                                          TITLE=EXCLUDED.TITLE,
                                          INVITE_LINK=EXCLUDED.INVITE_LINK,
                                          PERMISSIONS=EXCLUDED.PERMISSIONS,
                                          JOIN_TO_SEND_MESSAGES=EXCLUDED.JOIN_TO_SEND_MESSAGES,
                                          MAX_REACTION_COUNT=EXCLUDED.MAX_REACTION_COUNT,
                                          RAW=EXCLUDED.RAW;`,
	[chat?.id, chat?.type, chat?.title, chat?.invite_link, stringify(chat?.permissions), chat?.join_to_send_messages, chat?.max_reaction_count, stringify(chat)]
);

/**
 * Добавление пользователя в БД
 * @param {Object|User} user
 * @returns {Promise<*>}
 */
export const addUser2DB = async user => db.query(`
            INSERT INTO USERS(ID, USERNAME, FIRST_NAME, LAST_NAME, TYPE, ACTIVE_USERNAMES, BIO, HAS_PRIVATE_FORWARDS, MAX_REACTION_COUNT, RAW)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, STRING_TO_ARRAY($6::TEXT, ',')::TEXT[], $7::TEXT, $8::BOOL, $9::INT, $10::JSONB)
            ON CONFLICT(ID) DO UPDATE SET USERNAME=EXCLUDED.USERNAME,
                                          FIRST_NAME=EXCLUDED.FIRST_NAME,
                                          LAST_NAME=EXCLUDED.LAST_NAME,
                                          TYPE=EXCLUDED.TYPE,
                                          ACTIVE_USERNAMES=EXCLUDED.ACTIVE_USERNAMES,
                                          BIO=EXCLUDED.BIO,
                                          HAS_PRIVATE_FORWARDS=EXCLUDED.HAS_PRIVATE_FORWARDS,
                                          MAX_REACTION_COUNT=EXCLUDED.MAX_REACTION_COUNT,
                                          RAW=EXCLUDED.RAW;`,
	[user?.id, user?.username, user?.first_name, user?.last_name, user?.type, user?.active_usernames?.join(','), user?.bio, user?.has_private_forwards, user?.max_reaction_count, stringify(user)]
);

/**
 * Добавление связки Пользователь/Чат в БД
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @param {Boolean} bNew
 * @returns {Promise<*>}
 */
export const addUser2Chat2DB = async(chat, user, bNew) => db.query(`
            INSERT INTO USERS_CHATS(USER_ID, CHAT_ID, NEW_USER)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BOOL)
            ON CONFLICT(USER_ID, CHAT_ID) DO UPDATE SET NEW_USER=EXCLUDED.NEW_USER;`,
	[user?.id, chat?.id, bNew]
);

/**
 * Удаление пользователя из связки пользователь/чат
 * @param {Number} chat_id
 * @param {Number} user_id
 * @returns {Promise<*>}
 */
export const removeUserFromChat2DB = async(chat_id, user_id) => db.query(`
            DELETE
            FROM USERS_CHATS
            WHERE USER_ID = $1::BIGINT
              AND CHAT_ID = $2::BIGINT`,
	[user_id, chat_id]
);

/**
 * Получение статуса пользователя для конкретного чата
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @returns {Promise<{new_user: Boolean, blocked: Boolean}>}
 */
export const getUserStateFromChat = async(chat, user) => {
	/** @type {{rows:[{new_user: Boolean, is_blocked: Boolean}]}} */
	const res = await db.query(
		`SELECT NEW_USER, IS_BLOCKED
         FROM USERS_CHATS
         WHERE USER_ID = $1::BIGINT
           AND CHAT_ID = $2::BIGINT;`,
		[user?.id, chat?.id]
	);
	return {
		new_user: res?.rows[0]?.new_user,
		blocked:  res?.rows[0]?.is_blocked
	};
};

/**
 * Добавление сообщений в БД
 * @param {Object} ctx
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @param {Object} message
 * @returns {Promise<*>}
 */
export const addMessage2DB = async(ctx, chat, user, message) => db.query(`
            INSERT INTO MESSAGES (MESSAGE_ID, CHAT_ID, USER_ID, MESSAGE, CTX)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BIGINT, $4::JSONB, ($5::JSONB - 'telegram'))
            ON CONFLICT DO NOTHING;`,
	[message?.message_id, chat?.id, user?.id, stringify(message), stringify(ctx)]);

/**
 * Получаем историю сообщений по связке "ответ на" начиная с переданного id
 * @param {Number} bot_id
 * @param {Number} chat_id
 * @param {Number} from_message_id
 * @returns {Promise<[{role: String, content: String}]>}
 */
export const getMessagesReplyLink = async(bot_id, chat_id, from_message_id) => (await db.query(
	`WITH RECURSIVE MESS AS (SELECT M.CHAT_ID,
                                    M.MESSAGE_ID,
                                    (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                    M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                    (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                    M.TIMESTAMP                                                AS TS
                             FROM MESSAGES M
                             WHERE M.MESSAGE_ID = $1::BIGINT
                               AND M.CHAT_ID = $2::BIGINT
                             UNION
                             SELECT M.CHAT_ID,
                                    M.MESSAGE_ID,
                                    (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                    M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                    (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                    M.TIMESTAMP                                                AS TS
                             FROM MESSAGES M
                                      JOIN MESS MM ON M.MESSAGE_ID = MM.REPLY_ID AND M.CHAT_ID = MM.CHAT_ID)
     SELECT M.USER_ID, U.USERNAME, M.MESSAGE_TEXT
     FROM MESS M
              JOIN USERS U ON M.USER_ID = U.ID
     ORDER BY M.TS
     LIMIT 20;`, [from_message_id, chat_id]))?.rows?.map(row => {
	if(row){
		// Отрезаем командный текст, если он есть
		const arr = (/\/\w+\s?(.*)?/gmi).exec(row.message_text?.replace(/\s+/igm, ' '));
		return {
			role:    (parseInt(row.user_id, 10) === bot_id ? 'assistant' : 'user'), // только 'system', 'user', 'assistant', 'tool',
			name:    (parseInt(row.user_id, 10) === bot_id ? null : row.username),
			content: arr ? arr[1] : row.message_text
		};

	}else{
		return null;
	}
}).filter(row => !!row)?.filter(mess => !!mess?.content);

/**
 * Проверка, что ответ на сообщение был на цепочку сообщений общения с DeepSeek
 * @param {Number} chat_id
 * @param {Number} from_message_id
 * @returns {Promise<Boolean>}
 */
export const hasDeepSeekTalkMarker = async(chat_id, from_message_id) => !!(await db.query(
	`SELECT EXISTS(SELECT *
                   FROM (WITH RECURSIVE MESS AS (SELECT M.CHAT_ID,
                                                        M.MESSAGE_ID,
                                                        (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                        M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                        (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                        M.TIMESTAMP                                                AS TS
                                                 FROM MESSAGES M
                                                 WHERE M.MESSAGE_ID = $1::BIGINT
                                                   AND M.CHAT_ID = $2::BIGINT
                                                 UNION
                                                 SELECT M.CHAT_ID,
                                                        M.MESSAGE_ID,
                                                        (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                        M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                        (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                        M.TIMESTAMP                                                AS TS
                                                 FROM MESSAGES M
                                                          JOIN MESS MM ON M.MESSAGE_ID = MM.REPLY_ID AND M.CHAT_ID = MM.CHAT_ID)
                         SELECT *
                         FROM MESS
                         ORDER BY TS
                         LIMIT 20) _
                   WHERE UPPER(SUBSTRING(MESSAGE_TEXT FROM 1 FOR 9)) = '/DEEPSEEK');`, [from_message_id, chat_id]))?.rows[0].exists;

export const getNotPrivateChats = async() => db.query(`
    SELECT ID, TITLE
    FROM CHATS
    WHERE UPPER(TYPE) <> 'PRIVATE'
    ORDER BY ID;`);

export const getNewUsersFromChat = async(chat_id) => db.query(`
    SELECT UC.CHAT_ID, UC.USER_ID
    FROM USERS_CHATS UC
             JOIN MESSAGES M
                  ON UC.USER_ID = M.USER_ID
                      AND UC.CHAT_ID = M.CHAT_ID
    WHERE UC.CHAT_ID = $1::BIGINT
      AND UC.NEW_USER
      AND NOT UC.IS_BLOCKED
    GROUP BY UC.CHAT_ID, UC.USER_ID
    HAVING NOW() - MAX(M.TIMESTAMP) >= MAKE_INTERVAL(0, 0, 0, 0, 3)
    ORDER BY NOW() - MAX(M.TIMESTAMP) DESC, UC.USER_ID;`, [chat_id]);

export const getMessagesFromChatByInterval = async(chat_id, bot_id, interval = '2 HOURS') =>
	(await db.query(`
                SELECT U.ID AS USER_ID, U.USERNAME, M.MESSAGE ->> 'text' AS MESSAGE_TEXT
                FROM MESSAGES M
                         JOIN USERS U ON M.USER_ID = U.ID
                WHERE M.CHAT_ID = $1::BIGINT
                  AND M.TIMESTAMP >= NOW() - $2::INTERVAL
                  AND NOT (M.MESSAGE ->> 'text' ~* '^/')
                ORDER BY M.TIMESTAMP;`,
		[chat_id, interval]
	))?.rows?.map(row => {
		const content = row.message_text;
		const msg     = {
			role: parseInt(row.user_id, 10) === bot_id ? 'assistant' : 'user',
			content
		};

		if(msg.role === 'user' && row.username){
			msg.name = row.username;
		}

		return msg;
	}).filter(mess => !!mess?.content);

export const getChatsSettings = async(chat_id) => db.query(`
    SELECT ID, CLEAR_INTERVAL::TEXT AS CLEAR_INTERVAL
    FROM CHATS
    ORDER BY ID;`);

export const removeMessages = async(chat_id, interval) => chat_id && interval && db.query(`
            WITH DEL AS (
                DELETE FROM MESSAGES WHERE CHAT_ID = $1::BIGINT AND TIMESTAMP < NOW() - $2::INTERVAL RETURNING MESSAGES.MESSAGE_ID)
            SELECT COUNT(*)
            FROM DEL;`,
	[chat_id, interval]);

export const getChatAISettings = async(ctx, ai_id, analise, type) =>
	type ? db.query(`SELECT VALUE
                     FROM AI2CHAT_SETTINGS
                     WHERE AI_ID = $1::INT
                       AND CHAT_ID = $2::BIGINT
                       AND REASONER_MODE = $3::BOOL
                       AND TYPE = $4::TEXT
                     LIMIT 1;`, [ai_id, telegram.getChatFromCtx(ctx)?.id, !!analise, type])
		: db.query(`SELECT REASONER_MODE, TYPE, VALUE
                    FROM AI2CHAT_SETTINGS
                    WHERE AI_ID = $1::INT
                      AND CHAT_ID = $2::BIGINT
                      AND REASONER_MODE = $3::BOOL
                    ORDER BY TYPE;`, [ai_id, telegram.getChatFromCtx(ctx)?.id, !!analise]);

export const setChatAISettings = async(ctx, ai_id, analise, type, value) => {
	const chat = telegram.getChatFromCtx(ctx);
	if(ai_id && !isNaN(chat?.id) && type){
		return db.query(`
                    WITH INS AS (
                        INSERT INTO AI2CHAT_SETTINGS (CHAT_ID, AI_ID, TYPE, REASONER_MODE, VALUE)
                            VALUES ($1::BIGINT, $2::INT, $3::TEXT, $4::BOOL, $5::TEXT)
                            ON CONFLICT (CHAT_ID, AI_ID, TYPE, REASONER_MODE) DO UPDATE SET VALUE = EXCLUDED.VALUE
                            RETURNING 1)
                    SELECT COUNT(*)
                    FROM INS;`,
			[chat?.id, ai_id, type, !!analise, value]);
	}
};

export const insertAIRequest = async(ai_id, ai_kind, ai_model, messages) =>
	(await db.query(`WITH INS (ID) AS (
                INSERT
                    INTO AI_REQUEST (REQUEST, AI_ID, AI_KIND, AI_MODEL)
                        VALUES ($1::JSONB, $2:: INT, $3:: SMALLINT, $4:: SMALLINT) RETURNING ID)
                     SELECT ID
                     FROM INS;`,
		[JSON.stringify(messages, null, ''), ai_id, ai_kind, ai_model]))?.rows?.[0]?.id;

export const updateAIRequest = async(id, response, error) =>
	response ? (await db.query(`UPDATE AI_REQUEST
                                SET ANSWER           = $1::JSONB,
                                    ANSWER_TIMESTAMP = NOW()
                                WHERE ID = $2:: INT;`, [JSON.stringify(response, null, ''), id]))
		: error ? (await db.query(`UPDATE AI_REQUEST
                                   SET ERROR           = $1::JSONB,
                                       ERROR_TIMESTAMP = NOW()
                                   WHERE ID = $2:: INT;`, [JSON.stringify(error, null, ''), id]))
			: null;