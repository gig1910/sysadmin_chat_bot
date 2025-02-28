import * as db from './common/db.mjs';
import * as logger from './common/logger.mjs';

import {Markup, Telegraf} from 'telegraf';

import * as deepseek from './common/deepseek.mjs';
import {query} from "./common/db.mjs";

//-----------------------------

logger.info('Starting main').then();
const bot = new Telegraf(process.env.TOKEN);

const HelloText = `Привет, %fName% %lName% \(@%username%\).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

const makeName = (user) => `${user?.first_name ? user?.first_name : ''}${user?.last_name ? (user?.first_name ? ' ' : '') + user?.last_name : ''}`;

/**
 * Удаление сообщения
 * @param {Object} ctx
 * @param {Number} msg_id
 * @returns {Promise<Boolean>}
 */
const deleteMessage = async(ctx, msg_id) => {
	try{
		return await ctx.deleteMessage(msg_id);
		
	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка сообщений
 * @param {Object}   ctx
 * @param {String}   message
 * @param {Boolean}            [isMarkdown = false]
 * @returns {Promise<TextMessage>}
 */

const sendMessage = async(ctx, message, isMarkdown) => {
	try{
		let msg;
		if(isMarkdown){
			msg = await ctx.sendMessage(message, {parse_mode: 'MarkdownV2'});
		}else{
			msg = await ctx.sendMessage(message);
		}
		return msg;
		
	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка сообщений
 * @param {Object}   ctx
 * @param {Number}   reply_to
 * @param {String}   message
 * @param {Boolean} [isMarkdown = false]
 * @returns {Promise<TextMessage>}
 */
const replyMessage = async(ctx, reply_to, message, isMarkdown) => {
	try{
		let msg;
		if(isMarkdown){
			msg = await ctx.sendMessage(message, {parse_mode: 'Markdown', reply_to_message_id: reply_to});
		}else{
			msg = await ctx.sendMessage(message, {reply_to_message_id: reply_to});
		}
		return msg;
		
	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * @param {Object}   ctx
 * @param {String}   message
 * @param {Boolean} [isMarkdown=false]
 * @param {Number}  [timeout=1000]
 * @return {Promise<*>}
 */
const sendAutoRemoveMsg = async(ctx, message, isMarkdown, timeout) => {
	const msg = await sendMessage(ctx, message, isMarkdown);
	
	setTimeout(((ctx, msg) => () => deleteMessage(ctx, msg?.message_id))(ctx, msg), timeout || 1000);
	
	return msg;
};

const sentQuestion = async(ctx, question, buttons, timeout) => {
	const msg = await ctx.reply(
		question,
		Markup.inlineKeyboard([buttons]).oneTime().resize()
	);
	
	if(timeout > 0){
		setTimeout(((ctx, msg) => () => deleteMessage(ctx, msg?.message_id))(ctx, msg), timeout);
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
            INSERT INTO sysadmin_chat_bot.chats(id, type, title, invite_link, permissions, join_to_send_messages, max_reaction_count, raw)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::BOOL, $5::JSONB, $6::BOOL, $7::INT, $8::JSONB)
            ON CONFLICT(id) DO UPDATE SET type=excluded.type,
                                          title=excluded.title,
                                          invite_link=excluded.invite_link,
                                          permissions=excluded.permissions,
                                          join_to_send_messages=excluded.join_to_send_messages,
                                          max_reaction_count=excluded.max_reaction_count,
                                          raw=excluded.raw;`,
	[chat?.id, chat?.type, chat?.title, chat?.invite_link, JSON.stringify(chat?.permission), chat?.join_to_send_messages, chat?.max_reaction_count, JSON.stringify(chat)]
);

/**
 * Добавление пользователя в БД
 * @param {Object|User} user
 * @returns {Promise<*>}
 */
const addUser2DB = async user => db.query(`
            INSERT INTO sysadmin_chat_bot.users(id, username, first_name, last_name, type, active_usernames, bio, has_private_forwards, max_reaction_count, accent_color_id, raw)
            VALUES ($1::BIGINT, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, STRING_TO_ARRAY($6::TEXT, ',')::TEXT[], $7::TEXT, $8::BOOL, $9::INT, $10::INT, $11::JSONB)
            ON CONFLICT(id) DO UPDATE SET username=excluded.username,
                                          first_name=excluded.first_name,
                                          last_name=excluded.last_name,
                                          type=excluded.type,
                                          active_usernames=excluded.active_usernames,
                                          bio=excluded.bio,
                                          has_private_forwards=excluded.has_private_forwards,
                                          max_reaction_count=excluded.max_reaction_count,
                                          accent_color_id=excluded.accent_color_id,
                                          raw=excluded.raw;`,
	[user?.id, user?.username, user?.first_name, user?.last_name, user?.type, user?.active_usernames?.join(','), user?.bio, user?.has_private_forwards, user?.max_reaction_count, user?.accent_color_id, JSON.stringify(user)]
);

/**
 * Добавление связки Пользователь/Чат в БД
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @param {Boolean} bNew
 * @returns {Promise<*>}
 */
const addUser2Chat2DB = async(chat, user, bNew) => db.query(`
            INSERT INTO sysadmin_chat_bot.users_chats(user_id, chat_id, new_user)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BOOL)
            ON CONFLICT(user_id, chat_id) DO UPDATE SET new_user=excluded.new_user;`,
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
            FROM sysadmin_chat_bot.users_chats
            WHERE user_id = $1::BIGINT
              AND chat_id = $2::BIGINT`,
	[user?.id, chat?.id]
);

/**
 * Получение статуса пользователя для конкретного чата
 * @param {Object|Chat} chat
 * @param {Object|User} user
 * @returns {Promise<{new_user: Boolean, blocked: Boolean}>}
 */
const getUserStateFromChat = async(chat, user) => {
	/** @type {{rows:[{new_user: Boolean}]}} */
	const res = await db.query(
		`SELECT NEW_USER, isBlocked as is_blocked
         FROM sysadmin_chat_bot.users_chats
         WHERE user_id = $1::BIGINT
           AND chat_id = $2::BIGINT;`,
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
            INSERT INTO sysadmin_chat_bot.messages (message_id, chat_id, user_id, message, ctx)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BIGINT, $4::JSONB, $5::JSONB)
            ON CONFLICT DO NOTHING;`,
	[message?.message_id, chat?.id, user?.id, JSON.stringify(message), JSON.stringify(ctx)]);

const removeUserFromChat = async(ctx, chat, user) => {
	logger.info(`Blocked user ${user.id} in chat ${chat.id}...`).then();
	await bot.telegram.banChatMember(chat.id, user.id);
	await db.query(`
        UPDATE SYSADMIN_CHAT_BOT.USERS_CHATS UC
        SET isblocked= TRUE
        WHERE chat_id = $1::BIGINT
          AND user_id = $2::BIGINT;`, [chat.id, user.id]);
	
	return sendAutoRemoveMsg(ctx, `Участник ${makeName(user)} удалён как спамер.`);
};

//***************************************

bot.onerror = err => {
	logger.warn('bot - ERROR').then();
	logger.dir(err).then();
};

bot.start((ctx) => {
	return sendAutoRemoveMsg(ctx, 'Welcome');
});

bot.help((ctx) => {
	return sendAutoRemoveMsg(ctx, 'Bot for telergamm SysAdminChat');
});

bot.command('getchatid', async(ctx) => {
	const chat = ctx?.chat;
	const user = ctx.from;
	const message = ctx?.message || ctx?.update?.edited_message;
	
	// Сохраняем сообщение
	addMessage2DB(ctx, chat, user, message).then();
	
	deleteMessage(ctx, message?.message_id).then();
	
	return sendAutoRemoveMsg(ctx, `userID: ${user?.id}; chatID: ${chat?.id}`, false, 5000);
});

bot.command('question', async(ctx) => {
	return ctx.sendMessage(`*Как правильно задавать вопрос\\.*

1\\. Укажите именно суть вопроса\\.
    "*_У меня не работает_*” \\- это не вопрос\\. *__Это утверждение__*\\.

Пример вопроса:
    ◦ "У меня не выполняется \\(\`КОД|КОМАНДА|МЕТОД\`\\) и выдаёт ошибку в \\(\`КОНСОЛЬ|ЛОГ|ЭКРАН\`\\)"\\.
    ◦ "У меня есть \\(\`НЕОБХОДИМОСТЬ|ПОТРЕБНОСТЬ|ЗАДАЧА\`\\) сделать \\(\`ДЕЙСТВИЕ\`\\) посредством \\(\`ЧЕГО\\-ТО\`\\)\\. \\(\`КАК|ЧЕМ\`\\) это можно выполнить?"
    ◦ "При использовании \\(\`КОМАНДЫ|НАСТРОЙКИ|ПРОГРАММЫ\`\\) у меня возникает \`ОШИБКА\`\\. Вот \\(\`КОД|КОМАНДА|НАСТРОЙКА\`\\), как я пробую\\."

2\\. Приведите достаточный для воспроизведения Вашей ошибки минимальный \\(\`КОД|НАСТРОЙКУ|КОНФИГ\`\\) \\(_proof\\-of\\-concept_\\), который при этом ещё не придётся исправлять от ошибок для того, чтобы попробовать его выполнить\\.

3\\. Старайтесь пользоваться [Markdown](https://ru.wikipedia.org/wiki/Markdown) для правильной разметки вашего сообщения \\(смотри справку по мессенджеру\\)\\. Слишком большой текст не размещайте в сообщении \\(приложите вложением\\)\\.

4\\. При выполнении п\\.3 придерживайтесь принципа достаточной разумности\\. Выкладывать логи за год работы не надо, как и выкладывать сразу всю всю информацию \\(отчёт Aida о Вашей рабочей станции, положения звёзд в момент возникновения ошибки и прочих данных\\)\\. По необходимости всю доп\\. информацию у Вас запросят\\.

5\\. Не выкладывайте архивы на ресурсы, которые требуют просмотра рекламы, денег или ожидания для скачивания\\. Есть множество других хороших файл\\-обменников: [Google Drive](https://drive.google.com), [Облако Mail\\.ru](https://cloud.mail.ru), [Dropbox](https://www.dropbox.com), [Yandex\\.Disk](https://360.yandex.ru/disk)\\. Пользуйтесь ими\\.

6\\. По возможности приводите полные логи возникновения ошибки, при этом, если они достаточно большие, то архивируйте их\\. Но с учётом п\\.4\\.

7\\. Указывайте, \`В ЧЕМ\` \\(\`IDE\`, \`компилятор\`, \`браузер\`, \`ПО\`, \`консоль\`, \`ЛОГ\`\\) и на какой \`ОС\` \\(версия, разрядность, виртуализация, тип контейнера\\) проявляется данная ошибка\\.

8\\.  Поясните сразу все, что *УЖЕ* пробовали делать для исправления ситуации, а также *ВСЕ* ограничения\\. Этим Вы убережете свою нервную систему от неподходящих Вам ответов\\.`,
		{parse_mode: 'MarkdownV2'}
	);
});

bot.command('deepseek_test_spam', async(ctx) => {
	const message = ctx?.message || ctx?.update?.edited_message;
	
	const arr = (/\/deepseek_test_spam (.*)/gmi).exec(message?.text?.replace(/\s+/igm, ' '));
	const prompt = arr ? arr[1] : message?.text;
	
	const answer = await deepseek.testMessage(prompt);
	
	return replyMessage(ctx,
		ctx?.message?.message_id,
		answer || 'NOT_ANSWER',
		false);
});

bot.command('deepseek_message', async(ctx) => {
	const message = ctx?.message || ctx?.update?.edited_message;
	
	const arr = (/\/deepseek_message (.*)/gmi).exec(message?.text?.replace(/\s+/igm, ' '));
	const prompt = arr ? arr[1] : message?.text;
	
	const answer = await deepseek.sendQuestion(prompt);
	
	return replyMessage(ctx,
		ctx?.message?.message_id,
		answer || 'NOT_ANSWER',
		false);
});

bot.action('apply_rules', async(ctx) => {
	const message = ctx?.update?.callback_query?.message;
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
});

bot.on('new_chat_members', async(ctx) => {
	const arr = [];
	logger.log('new_chat_members').then();
	
	const func = async(user) => {
		const message = ctx?.message;
		const chat = message.chat;
		
		// const chat = await ctx.telegram.getChat(chatID);
		await addChat2DB(chat);
		
		// Проверяем наличие участника в БД
		await addUser2DB(user);
		
		// Проверяем участника в связке, если нет - добавляем как нового
		await addUser2Chat2DB(chat, user, true);
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		deleteMessage(ctx, ctx?.message?.id).then();
		
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
		const user = ctx?.message?.new_chat_members[i];
		arr.push(func(user));
	}
	
	return Promise.all(arr);
});

bot.on('left_chat_member', async(ctx) => {
	const arr = [];
	logger.log('left_chat_member').then();
	
	const func = async(user) => {
		const message = ctx?.message;
		const chat = message.chat;
		
		await addChat2DB(chat);
		await addUser2DB(user);
		await removeUserFromChat2DB(chat, user);
		
		// Сохраняем сообщение
		addMessage2DB(ctx, chat, user, message).then();
		
		deleteMessage(ctx, ctx?.message?.id).then();
	};
	
	for(let i = 0; i < ctx?.message?.left_chat_member; i++){
		const user = ctx?.message?.left_chat_member    [i];
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
], async(ctx) => {
	logger.log('chat message').then();
	const message = ctx?.message || ctx?.update?.edited_message;
	const chat = message.chat;
	const user = message?.from;
	
	await addChat2DB(chat);
	
	// Проверяем наличие участника в БД
	await addUser2DB(user);
	
	//Получаем значение участника для чата
	const userState = await getUserStateFromChat(chat, user);
	if(userState?.blocked){
		// Пользователь УЖЕ заблокирован. Просто удаляем его сообщение
		return deleteMessage(ctx, message?.message_id);
		
	}else if(typeof (userState?.new_user) !== 'boolean'){
		// добавляем участника в чат как нового
		await addUser2Chat2DB(chat, user, true);
	}
	
	// Сохраняем сообщение
	addMessage2DB(ctx, chat, user, message).then();
	
	if(chat.id > 0){    // Личные сообщения
		// Получаем список последних 20 сообщений (для нормального сохранения истории) и скармливаем это DeepSeek
		// Ответ отправляем как ответ на сообщение, т.к. возможен разрыв с ответах, что бы понимать на что DeepSeek отвечал
		const botInfo = ctx?.botInfo;
		if(botInfo){
			await addUser2DB(botInfo);
			const messages = await query(`
                SELECT user_id, message->>'text' AS message
                FROM (SELECT user_id, message, timestamp
                      FROM SYSADMIN_CHAT_BOT.MESSAGES
                      WHERE chat_id = $1::BIGINT
                        AND user_id IN ($2::BIGINT, $3::BIGINT)
                      AND substring(message->>'text' from 1 for 1) <> '/'
                      ORDER BY timestamp DESC
                      LIMIT 20) _
                ORDER BY timestamp;
			`, [chat.id, user.id, botInfo.id]);
			
			const answer = await deepseek.sendMessages(messages?.rows?.map(el => { return {role: (parseInt(el.user_id, 10) === botInfo.id ? 'assistant' : 'user'), content: el.message}; }));
			const mess = await replyMessage(
				ctx,
				message?.message_id,
				answer?.content?.replace(/\./igm, '\.').replace(/\(/igm, '\('),
				true);
			addMessage2DB(ctx, chat, botInfo, mess).then();
			
			return mess;
		}
		
	}else{              // Сообщение в группу
		if(userState?.new_user !== false){
			// Обработка сообщения нового пользователя
			await deleteMessage(ctx, message?.message_id);
			
			if(ctx?.message?.text){
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
				
			}else if(!ctx.message){
				// Ну кто начинает "Общение" выкладывая сразу только картинку? СПАМЕР!!!!
				
				// Просто удаляем пользователя как спамера
				return removeUserFromChat(ctx, chat, user);
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
                  AND NOT UC.ISBLOCKED
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
                        SET isblocked= TRUE
                        WHERE chat_id = $1::BIGINT
                          AND user_id = $2::BIGINT;`, [user.chat_id, user.user_id]);
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
