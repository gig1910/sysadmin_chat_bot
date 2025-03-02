import * as db from './common/db.mjs';
import * as logger from './common/logger.mjs';
import CircularJSON from 'circular-json';

import {Markup, Telegraf} from 'telegraf';

import * as deepseek from './common/deepseek.mjs';

//-----------------------------

logger.info('Starting main').then();
const bot = new Telegraf(process.env.TOKEN);

const HelloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

const makeName = (user) => `${user?.first_name ? user?.first_name : ''}${user?.last_name ? (user?.first_name ? ' ' : '') + user?.last_name : ''}`;

/**
 * Удаление сообщения
 * @param {CTX}    ctx
 * @param {Number} msg_id
 * @returns {Promise<Boolean>}
 */
const deleteMessage = async(ctx, msg_id) => {
	try{
		return ctx.deleteMessage(msg_id);
		
	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка сообщений
 * @param {CTX}      ctx
 * @param {String}   message
 * @param {Boolean} [isMarkdown = false]
 * @returns {Promise<Message.TextMessage>}
 */
const sendMessage = async(ctx, message, isMarkdown) => {
	try{
		let msg;
		if(isMarkdown){
			while (message){
				const mess_to_send = message.substring(0, 4000);
				message = message.substring(4000);
				msg = ctx.sendMessage(mess_to_send, {parse_mode: 'Markdown'});
			}

		}else{
			while (message){
				const mess_to_send = message.substring(0, 4000);
				message = message.substring(4000);
				msg = ctx.sendMessage(mess_to_send);
			}
		}
		return msg;
		
	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка сообщений
 * @param {CTX}      ctx
 * @param {Number}   reply_to
 * @param {String}   message
 * @param {Boolean} [isMarkdown = false]
 * @returns {Promise<Message.TextMessage>}
 */
const replyMessage = async(ctx, reply_to, message, isMarkdown) => {
	try{
		let msg;
		if(isMarkdown){
			while (message){
				const mess_to_send = message.substring(0, 4000);
				message = message.substring(4000);
				msg = ctx.sendMessage(mess_to_send, {parse_mode: 'Markdown', reply_to_message_id: reply_to});
			}

		}else{
			while (message){
				const mess_to_send = message.substring(0, 4000);
				message = message.substring(4000);
				msg = ctx.sendMessage(mess_to_send, {reply_to_message_id: reply_to});
			}
		}
		return msg;
		
	}catch(err){
		logger.warn(`message.length: ${message.length}`).then();
		logger.warn(err).then();
	}
};

/**
 * Отправка авто-удаляемого сообщения
 * @param {CTX}      ctx
 * @param {String}   message
 * @param {Boolean} [isMarkdown=false]
 * @param {Number}  [timeout=1000]
 * @return {Promise<Message.TextMessage>}
 */
const sendAutoRemoveMsg = async(ctx, message, isMarkdown, timeout) => {
	const msg = sendMessage(ctx, message, isMarkdown);
	
	setTimeout(((ctx, msg) =>  async () => {
		msg = await msg;
		return deleteMessage(ctx, msg?.message_id);
	})(ctx, msg), timeout || 1000);
	
	return msg;
};

/**
 * Отправка вопроса с кнопками ответа
 * @param {CTX}      ctx
 * @param {String}   question
 * @param {Array}    buttons
 * @param {Number}  [timeout=1000]
 * @return {Promise<Message.TextMessage>}
 */
const sentQuestion = async(ctx, question, buttons, timeout) => {
	const msg = ctx.reply(
		question,
		Markup.inlineKeyboard([buttons]).oneTime().resize()
	);
	
	if(timeout > 0){
		setTimeout(((ctx, msg) => async () => {
			msg = await msg;
			return deleteMessage(ctx, msg?.message_id);
		})(ctx, msg), timeout);
	}
	
	return msg;
};

//***************************************

/**
 * @typedef Chat
 * @property id {Number}
 * @property type {String
 * @property title {String}
 * @property invite_link {String}
 * @property permission {Object}
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
const addChat2DB = async chat => db.query(`
            INSERT INTO SYSADMIN_CHAT_BOT.CHATS(ID, TYPE, TITLE, INVITE_LINK, PERMISSIONS, JOIN_TO_SEND_MESSAGES, MAX_REACTION_COUNT, RAW)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::BOOL, $5::JSONB, $6::BOOL, $7::INT, $8::JSONB)
            ON CONFLICT(ID) DO UPDATE SET TYPE=EXCLUDED.TYPE,
                                          TITLE=EXCLUDED.TITLE,
                                          INVITE_LINK=EXCLUDED.INVITE_LINK,
                                          PERMISSIONS=EXCLUDED.PERMISSIONS,
                                          JOIN_TO_SEND_MESSAGES=EXCLUDED.JOIN_TO_SEND_MESSAGES,
                                          MAX_REACTION_COUNT=EXCLUDED.MAX_REACTION_COUNT,
                                          RAW=EXCLUDED.RAW;`,
	[chat?.id, chat?.type, chat?.title, chat?.invite_link, CircularJSON.stringify(chat?.permission), chat?.join_to_send_messages, chat?.max_reaction_count, CircularJSON.stringify(chat)]
);

/**
 * Добавление пользователя в БД
 * @param {Object|User} user
 * @returns {Promise<*>}
 */
const addUser2DB = async user => db.query(`
            INSERT INTO SYSADMIN_CHAT_BOT.USERS(ID, USERNAME, FIRST_NAME, LAST_NAME, TYPE, ACTIVE_USERNAMES, BIO, HAS_PRIVATE_FORWARDS, MAX_REACTION_COUNT, ACCENT_COLOR_ID, RAW)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, STRING_TO_ARRAY($6::TEXT, ',')::TEXT[], $7::TEXT, $8::BOOL, $9::INT, $10::INT, $11::JSONB)
            ON CONFLICT(ID) DO UPDATE SET USERNAME=EXCLUDED.USERNAME,
                                          FIRST_NAME=EXCLUDED.FIRST_NAME,
                                          LAST_NAME=EXCLUDED.LAST_NAME,
                                          TYPE=EXCLUDED.TYPE,
                                          ACTIVE_USERNAMES=EXCLUDED.ACTIVE_USERNAMES,
                                          BIO=EXCLUDED.BIO,
                                          HAS_PRIVATE_FORWARDS=EXCLUDED.HAS_PRIVATE_FORWARDS,
                                          MAX_REACTION_COUNT=EXCLUDED.MAX_REACTION_COUNT,
                                          ACCENT_COLOR_ID=EXCLUDED.ACCENT_COLOR_ID,
                                          RAW=EXCLUDED.RAW;`,
	[user?.id, user?.username, user?.first_name, user?.last_name, user?.type, user?.active_usernames?.join(','), user?.bio, user?.has_private_forwards, user?.max_reaction_count, user?.accent_color_id, CircularJSON.stringify(user)]
);

/**
 * Добавление связки Пользователь/Чат в БД
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @param {Boolean} bNew
 * @returns {Promise<*>}
 */
const addUser2Chat2DB = async(chat, user, bNew) => db.query(`
            INSERT INTO SYSADMIN_CHAT_BOT.USERS_CHATS(USER_ID, CHAT_ID, NEW_USER)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BOOL)
            ON CONFLICT(USER_ID, CHAT_ID) DO UPDATE SET NEW_USER=EXCLUDED.NEW_USER;`,
	[user?.id, chat?.id, bNew]
);

/**
 * Удаление пользователя из связки пользователь/чат
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @returns {Promise<*>}
 */
const removeUserFromChat2DB = async(chat, user) => db.query(`
            DELETE
            FROM SYSADMIN_CHAT_BOT.USERS_CHATS
            WHERE USER_ID = $1::BIGINT
              AND CHAT_ID = $2::BIGINT`,
	[user?.id, chat?.id]
);

/**
 * Получение статуса пользователя для конкретного чата
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @returns {Promise<{new_user: Boolean, blocked: Boolean}>}
 */
const getUserStateFromChat = async(chat, user) => {
	/** @type {{rows:[{new_user: Boolean, is_blocked: Boolean}]}} */
	const res = await db.query(
		`SELECT NEW_USER, IS_BLOCKED
         FROM SYSADMIN_CHAT_BOT.USERS_CHATS
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
const addMessage2DB = async(ctx, chat, user, message) => db.query(`
            INSERT INTO SYSADMIN_CHAT_BOT.MESSAGES (MESSAGE_ID, CHAT_ID, USER_ID, MESSAGE, CTX)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BIGINT, $4::JSONB, $5::JSONB)
            ON CONFLICT DO NOTHING;`,
	[message?.message_id, chat?.id, user?.id, CircularJSON.stringify(message), CircularJSON.stringify(ctx)]);

/**
 * @param {CTX} ctx
 * @param {Chat} chat
 * @param {User} user
 * @returns {Promise<Message.TextMessage>}
 */
const removeUserFromChat = async(ctx, chat, user) => {
	logger.info(`Blocked user ${user.id} in chat ${chat.id}...`).then();
	await bot.telegram.banChatMember(chat.id, user.id);
	await db.query(`
        UPDATE SYSADMIN_CHAT_BOT.USERS_CHATS UC
        SET IS_BLOCKED= TRUE
        WHERE CHAT_ID = $1::BIGINT
          AND USER_ID = $2::BIGINT;`, [chat.id, user.id]);
	
	return sendAutoRemoveMsg(ctx, `Участник ${makeName(user)} удалён как спамер.`);
};

// ------------------------------------------------

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @returns {Promise<Message.TextMessage>}
 */
const deepSeekTalks = async(ctx) => {
	const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message?.message_id && message?.text){
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			const chat = message.chat;
			const user = message.from;
			
			// Сохраняем сообщение (Тут надо дождаться что бы из БД получить сразу весь диалог, включая ЭТО сообщение )
			await addMessage2DB(ctx, chat, user, message);
			
			// Получаем историю сообщений
			const messages = (await db.query(
				`WITH RECURSIVE MESSAGES (MESSAGE_ID, USER_ID, MESSAGE_TEXT, REPLY_ID, TS) AS (SELECT M.MESSAGE_ID,
                                                                                                      (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                                                                      M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                                                                      (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                                                                      M.TIMESTAMP                                                AS TS
                                                                                               FROM SYSADMIN_CHAT_BOT.MESSAGES M
                                                                                               WHERE M.MESSAGE_ID = $1::BIGINT
                                                                                               UNION
                                                                                               SELECT M.MESSAGE_ID,
                                                                                                      (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                                                                      M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                                                                      (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                                                                      M.TIMESTAMP                                                AS TS
                                                                                               FROM SYSADMIN_CHAT_BOT.MESSAGES M
                                                                                                        JOIN MESSAGES MM ON M.MESSAGE_ID = MM.REPLY_ID)
                 SELECT M.USER_ID, U.USERNAME, M.MESSAGE_TEXT
                 FROM MESSAGES M JOIN SYSADMIN_CHAT_BOT.USERS U ON M.USER_ID=U.ID
                 ORDER BY TS
                 LIMIT 20;`, [message.message_id]))?.rows?.map(row => {
				if(row){
					// Отрезаем командный текст, если он есть
					const arr = (/\/\w+\s?(.*)?/gmi).exec(row.message_text.replace(/\s+/igm, ' '));
					return {
						role:    (parseInt(row.user_id, 10) === ctx?.botInfo.id ? 'assistant' : 'user'), // только 'system', 'user', 'assistant', 'tool'
						content: arr ? arr[1] : row.message_text
					};
					
				}else{
					return null;
				}
			}).filter(row => !!row)?.filter(mess => !!mess?.content);
			
			if(messages?.length > 0){
				// Запрашиваем ответ у DeepSeek
				const answer = await deepseek.sendMessages(messages);
				if(answer){
					// Отправляем ответ DeepSeek как ответ на сообщение
					const mess = await replyMessage(ctx, message?.message_id, answer?.content, true);
					
					//Сохраняем ответ DeepSeek в БД для получения полноценного диалога
					addMessage2DB(ctx, chat, botInfo, mess).then();
					
					return mess;
				}
			}
		}
	}
};

/**
 * Проверка, что ответ на сообщение был на цепочку сообщений общения с DeepSeek
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
const hasDeepSeekTalkMarker = async(ctx) => {
	const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message?.message_id && message?.text){
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			// Получаем историю сообщений и проверяем наличие команды на диалог с deepseek
			return !!(await db.query(
				`
                    SELECT EXISTS(SELECT *
                                  FROM (WITH RECURSIVE MESSAGES (MESSAGE_ID, USER_ID, MESSAGE_TEXT, REPLY_ID, TS) AS (SELECT M.MESSAGE_ID,
                                                                                                                             (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                                                                                             M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                                                                                             (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                                                                                             M.TIMESTAMP                                                AS TS
                                                                                                                      FROM SYSADMIN_CHAT_BOT.MESSAGES M
                                                                                                                      WHERE M.MESSAGE_ID = $1::BIGINT
                                                                                                                      UNION
                                                                                                                      SELECT M.MESSAGE_ID,
                                                                                                                             (M.MESSAGE -> 'from' ->> 'id')::BIGINT                     AS USER_ID,
                                                                                                                             M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
                                                                                                                             (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
                                                                                                                             M.TIMESTAMP                                                AS TS
                                                                                                                      FROM SYSADMIN_CHAT_BOT.MESSAGES M
                                                                                                                               JOIN MESSAGES MM ON M.MESSAGE_ID = MM.REPLY_ID)
                                        SELECT *
                                        FROM MESSAGES
                                        ORDER BY TS
                                        LIMIT 20) _
                                  WHERE UPPER(SUBSTRING(MESSAGE_TEXT FROM 1 FOR 9)) = '/DEEPSEEK');`, [message.message_id]))?.rows[0].exists;
		}
	}
	
	return false;
};

//***************************************

bot.onerror = err => {
	logger.warn('bot - ERROR').then();
	logger.dir(err).then();
};

bot.start(/** @param {CTX} ctx */ async(ctx) => {
	return sendAutoRemoveMsg(ctx, 'Welcome');
});

bot.help(/** @param {CTX} ctx */ async(ctx) => {
	return sendAutoRemoveMsg(ctx, 'Bot for telergam SysAdminChat');
});

bot.command('getchatid', /** @param {CTX} ctx */ async(ctx) => {
	/** @type {Chat} */ const chat = ctx?.update?.chat;
	/** @type {From} */ const user = ctx?.update?.from;
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	
	// Сохраняем сообщение
	addMessage2DB(ctx, chat, user, message).then();
	
	deleteMessage(ctx, message?.message_id).then(); // Удаляем командное сообщение
	
	return sendAutoRemoveMsg(ctx, `userID: ${user?.id}; chatID: ${chat?.id}`, false, 5000);
});

bot.command('question', /** @param {CTX} ctx */ async(ctx) => {
	return ctx.sendMessage(
		`*Как правильно задавать вопрос.*

1. Укажите именно суть вопроса.
    "*У меня не работает*” - это не вопрос. *Это утверждение*.

Пример вопроса:
    ◦ "У меня не выполняется (\`КОД|КОМАНДА|МЕТОД\`) и выдаёт ошибку в (\`КОНСОЛЬ|ЛОГ|ЭКРАН\`)".
    ◦ "У меня есть (\`НЕОБХОДИМОСТЬ|ПОТРЕБНОСТЬ|ЗАДАЧА\`) сделать (\`ДЕЙСТВИЕ\`) посредством (\`ЧЕГО-ТО\`). (\`КАК|ЧЕМ\`) это можно выполнить?"
    ◦ "При использовании (\`КОМАНДЫ|НАСТРОЙКИ|ПРОГРАММЫ\`) у меня возникает \`ОШИБКА\`. Вот (\`КОД|КОМАНДА|НАСТРОЙКА\`), как я пробую."

2. Приведите достаточный для воспроизведения Вашей ошибки минимальный (\`КОД|НАСТРОЙКУ|КОНФИГ\`) (_proof-of-concept_), который при этом ещё не придётся исправлять от ошибок для того, чтобы попробовать его выполнить.

3. Старайтесь пользоваться [Markdown](https://ru.wikipedia.org/wiki/Markdown) для правильной разметки вашего сообщения (смотри справку по мессенджеру). Слишком большой текст не размещайте в сообщении (приложите вложением).

4. При выполнении п.3 придерживайтесь принципа достаточной разумности. Выкладывать логи за год работы не надо, как и выкладывать сразу всю всю информацию (отчёт Aida о Вашей рабочей станции, положения звёзд в момент возникновения ошибки и прочих данных). По необходимости всю доп. информацию у Вас запросят.

5. Не выкладывайте архивы на ресурсы, которые требуют просмотра рекламы, денег или ожидания для скачивания. Есть множество других хороших файл-обменников: [Google Drive](https://drive.google.com), [Облако Mail.ru](https://cloud.mail.ru), [Dropbox](https://www.dropbox.com), [Yandex.Disk](https://360.yandex.ru/disk). Пользуйтесь ими.

6. По возможности приводите полные логи возникновения ошибки, при этом, если они достаточно большие, то архивируйте их. Но с учётом п.4.

7. Указывайте, \`В ЧЕМ\` (\`IDE\`, \`компилятор\`, \`браузер\`, \`ПО\`, \`консоль\`, \`ЛОГ\`) и на какой \`ОС\` (версия, разрядность, виртуализация, тип контейнера) проявляется данная ошибка.

8.  Поясните сразу все, что *УЖЕ* пробовали делать для исправления ситуации, а также *ВСЕ* ограничения. Этим Вы убережете свою нервную систему от неподходящих Вам ответов.`,
		{parse_mode: 'Markdown'}
	);
});

bot.command('deepseek_test_spam', /** @param {CTX} ctx */ async(ctx) => {
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message.message_id && message?.text){
		const arr = (/\/deepseek_test_spam (.*)/gmi).exec(message.text?.replace(/\s+/igm, ' '));
		const prompt = arr ? arr[1] : message.text;
		
		const answer = await deepseek.testMessage(prompt);
		
		return replyMessage(ctx,
			message.message_id,
			answer || 'NOT_ANSWER',
			false);
	}
});

bot.command('deepseek', /** @param {CTX} ctx */ async(ctx) => deepSeekTalks(ctx));

bot.action('apply_rules', /** @param {CTX} ctx */ async(ctx) => {
	const message = ctx?.update?.callback_query?.message;
	if(message){
		const chat = message.chat;
		const user = ctx?.update?.callback_query.from;
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		const userState = await getUserStateFromChat(chat, user);
		if(userState?.new_user === false){
			sendAutoRemoveMsg(ctx, `${makeName(user)}, Вам не требовалось отвечать на этот вопрос.`, false, 20000).then();
			return false;
			
		}else{
			// Сбрасываем статус нового участника
			await addUser2Chat2DB(chat, user, false);
			sendAutoRemoveMsg(ctx, `Спасибо, ${makeName(user)}. Теперь Вы полноправный член группы.`, false, 20000).then();
			return true;
		}
	}
});

bot.on('new_chat_members', /** @param {CTX} ctx */ async(ctx) => {
	const arr = [];
	logger.log('new_chat_members').then();
	
	const func = async(user) => {
		const message = ctx?.update?.message;
		const chat = message?.chat;
		
		// const chat = await ctx.telegram.getChat(chatID);
		await addChat2DB(chat);
		
		// Проверяем наличие участника в БД
		await addUser2DB(user);
		
		// Проверяем участника в связке, если нет - добавляем как нового
		await addUser2Chat2DB(chat, user, true);
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		deleteMessage(ctx, ctx?.update?.message?.message_id).then();
		
		const _text = (HelloText || '')
			.replace(/%fName%/igm, user.first_name || '')
			.replace(/%lName%/igm, user.last_name || '')
			.replace(/%username%/igm, user.username || '');
		
		const _buttons = [];
		let bAccept = false;
		for(let i = 0; i < 3; i++){
			const bTrue = (Math.random() >= 0.5);
			if(!bAccept && (bTrue || i > 1)){
				_buttons.push(Markup.button.callback('Принимаю правила', 'apply_rules', false));
				bAccept = true;
				
			}else{
				_buttons.push(Markup.button.callback((Math.random() >= 0.5) ? 'Не принимаю правила' : 'Я бот', 'reject_rules', false));
			}
		}
		
		return sentQuestion(ctx, _text,
			_buttons,
			3600000);
	};
	
	for(let i = 0; i < ctx?.message?.new_chat_members; i++){
		const user = ctx?.update?.message?.new_chat_members[i];
		arr.push(func(user));
	}
	
	return Promise.all(arr);
});

bot.on('left_chat_member', /** @param {CTX} ctx */ async(ctx) => {
	const arr = [];
	logger.log('left_chat_member').then();
	
	const func = async(user) => {
		const message = ctx?.update?.message;
		const chat = message?.chat;
		
		await addChat2DB(chat);
		await addUser2DB(user);
		await removeUserFromChat2DB(chat, user);
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		deleteMessage(ctx, ctx?.message?.id).then();
	};
	
	for(let i = 0; i < ctx?.message?.left_chat_member; i++){
		const user = ctx?.message?.left_chat_member[i];
		arr.push(func(user));
	}
	
	return Promise.all(arr);
});

/*
"pre_checkout_query" | "poll_answer" | "poll" | "shipping_query" | "chat_join_request" | "chat_boost" | "removed_chat_boost" | "has_media_spoiler" | "new_chat_members" | "left_chat_member" |
"new_chat_title" | "new_chat_photo" | "delete_chat_photo" | "group_chat_created" | "supergroup_chat_created" | "channel_chat_created" | "message_auto_delete_timer_changed" | "migrate_to_chat_id" |
"migrate_from_chat_id" | "pinned_message" | "invoice" | "successful_payment" | "connected_website" | "write_access_allowed" | "passport_data" | "proximity_alert_triggered" | "boost_added" |
"forum_topic_created" | "forum_topic_edited" | "forum_topic_closed" | "forum_topic_reopened" | "general_forum_topic_hidden" | "general_forum_topic_unhidden" |
"giveaway_created" | "giveaway" | "giveaway_winners" | "giveaway_completed" | "video_chat_scheduled" | "video_chat_started" | "video_chat_ended" | "video_chat_participants_invited" |
"web_app_data" | "game" | "story" | "venue" | "forward_date"
*/
bot.on([
	'text', 'message', 'edited_message', 'sticker', 'animation', 'audio', 'document', 'photo', 'video', 'video_note', 'voice',
	'channel_post', 'chat_member', 'chosen_inline_result', 'edited_channel_post', 'message_reaction', 'message_reaction_count',
	'my_chat_member', 'chat_join_request', 'contact', 'dice', 'location', 'users_shared', 'chat_shared'
], /** @param {CTX} ctx */ async(ctx) => {
	logger.log('chat message').then();
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message.message_id){
		const chat = message.chat;
		const user = message.from;
		
		await addChat2DB(chat);
		
		// Проверяем наличие участника в БД
		await addUser2DB(user);
		
		//Получаем значение участника для чата
		const userState = await getUserStateFromChat(chat, user);
		if(userState?.blocked){
			// Пользователь УЖЕ заблокирован. Просто удаляем его сообщение
			return deleteMessage(ctx, message.message_id);
			
		}else if(typeof (userState?.new_user) !== 'boolean'){
			// добавляем участника в чат как нового
			await addUser2Chat2DB(chat, user, true);
		}
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		if(chat.id > 0){    // Личные сообщения
			
			// Получаем список 20 сообщений как диалог (сообщения по ответам) для нормального сохранения истории и скармливаем это DeepSeek
			// Ответ отправляем как ответ на сообщение, т.к. возможен разрыв в ответах, что бы понимать на что DeepSeek отвечал
			return deepSeekTalks(ctx);
			
		}else{              // Сообщение в группу
			if(userState?.new_user !== false){
				// Обработка сообщения нового пользователя
				await deleteMessage(ctx, message.message_id);
				
				if(message?.text){
					// Показываем приветственный текст с предложением принять правила группы
					const _buttons = [];
					let bAccept = false;
					for(let i = 0; i < 3; i++){
						const bTrue = Math.round(1) >= 0.5;
						if(bTrue && !bAccept){
							_buttons.push(Markup.button.callback('Принимаю правила', 'apply_rules', false));
							bAccept = true;
						}else if(i === 2 && !bAccept){
							_buttons.push(Markup.button.callback('Принимаю правила', 'apply_rules', false));
							bAccept = true;
						}else{
							_buttons.push(Markup.button.callback(Math.round(1) >= 0.5 ? 'Не принимаю правила' : 'Я бот', 'reject_rules', false));
						}
					}
					
					//Отправляем сообщение на проверку на SPAM
					deepseek.isSpamMessage(ctx?.message?.text).then(async res => {
						if(res){
							// Просто удаляем пользователя как спамера
							return removeUserFromChat(ctx, chat, user);
						}
					});
					
					return sentQuestion(ctx,
						`${makeName(
							user)}, Вы ещё не подтвердили принятие правил данного чата. Писать сообщения Вы сможете только после того, как примите правила.\n\nПеред тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`,
						_buttons,
						20000
					);
					
				}else{
					// Ну кто начинает "Общение" выкладывая сразу только картинку, видео, аудио или документ? СПАМЕР!!!!
					
					// Просто удаляем пользователя как спамера
					return removeUserFromChat(ctx, chat, user);
				}
				
			}else if(message?.reply_to_message){
				if(await hasDeepSeekTalkMarker(ctx)){
					// Продолжаем диалог
					return deepSeekTalks(ctx);
				}
			}
		}
	}
});

let process_users_handler;

(async() => {
	try{
		logger.info('Opening DB...').then();
		await db.open_db();
		logger.info('DB is opened.').then();
		logger.info('Testing connect to DB...').then();
		await db.query('SELECT 1;');
		logger.info('Connect to DB was been tested.').then();
		
		
		logger.info('Launch bot...').then();
		bot.launch().then();
		logger.info('Bot is launching.').then();
		
		process_users_handler = setInterval(async() => { // Запуск процесса очистки группы от ботов, которые более чем 3 часа не отвечают на запрос принятия правил группы (запуск раз в полчаса)
			logger.info('Start interval function for clear chats...').then();
			
			logger.info('getting forgotten users from chats...').then();
			// Получаем список всех пользователей, которые отправили сообщение в чат или вошли в чат, но так и не приняли правила чата (99,9999% что это боты)
			const users = await db.query(`
                SELECT UC.CHAT_ID, UC.USER_ID
                FROM SYSADMIN_CHAT_BOT.USERS_CHATS UC
                         JOIN SYSADMIN_CHAT_BOT.MESSAGES M ON UC.USER_ID = M.USER_ID
                WHERE UC.CHAT_ID = -1001325427983
                  AND UC.NEW_USER
                  AND NOT UC.IS_BLOCKED
                GROUP BY UC.CHAT_ID, UC.USER_ID
                HAVING NOW() - MAX(M.TIMESTAMP) >= MAKE_INTERVAL(0, 0, 0, 0, 3)
                ORDER BY NOW() - MAX(M.TIMESTAMP) DESC, UC.USER_ID;`);
			
			for(let i = 0; i < users.rows.length; i++){
				const user = users.rows[i];
				if(user){
					logger.info(`Blocked user ${user.user_id} in chat ${user.chat_id}...`).then();
					await bot.telegram.banChatMember(user.chat_id, user.user_id);
					await db.query(`
                        UPDATE SYSADMIN_CHAT_BOT.USERS_CHATS UC
                        SET IS_BLOCKED= TRUE
                        WHERE CHAT_ID = $1::BIGINT
                          AND USER_ID = $2::BIGINT;`, [user.chat_id, user.user_id]);
				}
			}
			
		}, 60000);
		
	}catch(err){
		logger.err(err).then();
		bot.stop('SIGINT');
		return db.close_db();
	}
})();

// Enable graceful stop
process.once('SIGINT', () => {
	bot.stop('SIGINT');
	return db.close_db();
});
process.once('SIGTERM', () => {
	bot.stop('SIGINT');
	return db.close_db();
});
