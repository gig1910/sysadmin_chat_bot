import {Markup, Telegraf} from 'telegraf';

import {generateRegExp} from './common/regexp.mjs';
import {spam_rules} from './spam_rules/index.mjs';

import * as db from './common/db.mjs';

console.info('Starting main');
const bot = new Telegraf(process.env.TOKEN);

let helloText = `Привет, %fName% %lName% \(@%username%\).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

const bannedUserID = {};

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
		console.warn(err);
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
		console.warn(err);
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

const newUsers = {};

const sentQuestion = async(ctx, question, buttons, timeout) => {
	const user = ctx?.message?.from;
	
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

const addUser2Chat2DB = async (chat, user, bNew) => db.query(`
            INSERT INTO sysadmin_chat_bot.users_chats(user_id, chat_id, new_user)
            VALUES ($1::BIGINT, $2::BIGINT, $3::BOOL)
            ON CONFLICT(user_id, chat_id) DO UPDATE SET new_user=excluded.new_user;`,
	[user?.id, chat?.id, bNew]
);

const getUserStateFromChat = async (chat, user) => {
	const res = await db.query(
		`SELECT NEW_USER
         FROM sysadmin_chat_bot.users_chats
         WHERE user_id = $1::BIGINT
           AND chat_id = $2::BIGINT;`,
		[user?.id, chat?.id]
	);
	return res?.rows[0]?.new_user;
};

const addMessage2DB = async (ctx, chat, user, message) => db.query(`
                INSERT INTO sysadmin_chat_bot.messages (message_id, chat_id, user_id, message, ctx)
                VALUES ($1::BIGINT, $2::BIGINT, $3::BIGINT, $4::JSONB, $5::JSONB)
                ON CONFLICT DO NOTHING;`,
	[message?.message_id, chat?.id, user?.id, JSON.stringify(message), JSON.stringify(ctx)]);

//***************************************

bot.onerror = err => {
	console.warn('bot - ERROR');
	console.dir(err);
};

bot.start((ctx) => {
	return sendAutoRemoveMsg(ctx, 'Welcome');
});

bot.help((ctx) => {
	return sendAutoRemoveMsg(ctx, 'Bot for telergamm SysAdminChat');
});

bot.command('getchatid', async(ctx) => {
	const chatId = ctx?.chat?.id;
	const userId = ctx.from.id;
	const message = ctx?.message || ctx?.update?.edited_message;
	
	deleteMessage(ctx, message?.message_id).then();
	
	return sendAutoRemoveMsg(ctx, `userID: ${userId}; chatID: ${chatId}`, false, 5000);
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

bot.command('unblock_user', async(ctx) => {
	const message = ctx?.message || ctx?.update?.edited_message;
	deleteMessage(ctx, message?.message_id).then();
	
	//Проверяем права отправившего команду участника
	const userInfo = await bot.telegram.getChatMember(message?.chat?.id, message?.from?.id);
	if(['owner', 'administrator'].includes(userInfo?.status)){
		const arr = (/^\/unblock_user\s+(-?\d+)$/igm).exec(message?.text);
		if(arr?.length > 1){
			const userID = parseInt(arr[1]);
			if(userID > 0){
				bot.telegram.unbanChatMember(userID, message?.chat?.id);
				
			}else{
				return sendAutoRemoveMsg(ctx, `*Неверный формат команды\\.*
Правильный формат \`unblock_user userID\``, false, 2000);
			}
			
		}else{
			return sendAutoRemoveMsg(ctx, `*Неверный формат команды\\.*
Правильный формат \`unblock_user userID\``, false, 2000);
		}
		
	}else{
		return sendAutoRemoveMsg(ctx, 'У Вас нет прав на выполнение данный команды.', false, 5000);
	}
});

bot.command('test', async(ctx) => {
	const message = ctx?.message || ctx?.update?.edited_message;
	const arr = (/\/test (.*)/gmi).exec(message?.text?.replace(/\s+/igm, ' '));
	const test_message = arr ? arr[1] : message?.text;
	// deleteMessage(ctx, message?.message_id).then();
	
	for(let re of spam_rules || []){
		const _re = generateRegExp(re);
		if(_re?.test(test_message)){
			console.log(`found spam message: ${test_message}`);
			
			deleteMessage(ctx, message?.message_id).then();
			
			return sendAutoRemoveMsg(ctx,
				`Распознан спам по правилу: ${re}`,
				false,
				20000);
		}
	}
	return sendAutoRemoveMsg(ctx,
		`Не попадает под правила распознавания спама`,
		false,
		20000);
});

bot.action('apply_rules', async(ctx) => {
	const message = ctx?.update?.callback_query?.message;
	const chat = message.chat;
	const user = ctx?.update?.callback_query.from;
	
	const bNewUser = await getUserStateFromChat(chat, user);
	if(bNewUser === false){
		sendAutoRemoveMsg(ctx, `${user?.first_name} ${user?.last_name}, Вам не требовалось отвечать на этот вопрос.`, false, 10000).then();
		return false;

	}else{
		// Сбрасываем статус нового участника
		await addUser2Chat2DB(chat, user, false);
		sendAutoRemoveMsg(ctx, `Спасибо, ${user?.first_name} ${user?.last_name}. Теперь Вы полноправный член группы.`, false, 10000).then();
		return true;
	}
});

bot.on('new_chat_members', async (ctx) => {
	console.log('new_chat_members');
	
	const message = ctx?.message || ctx?.update?.edited_message;
	const chat = message.chat;
	const user = ctx?.message?.new_chat_member;
	
	// const chat = await ctx.telegram.getChat(chatID);
	await addChat2DB(chat);
	
	// Проверяем наличие участника в БД
	await addUser2DB(user);
	
	// Проверяем участника в связке, если нет - добавляем как нового
	await addUser2Chat2DB(chat, user, true);
	
	// Сохраняем сообщение
	addMessage2DB(ctx, chat, user, message).then();
	
	deleteMessage(ctx, ctx?.message?.id).then();
	
	const _text = (helloText || '')
		.replace(/%fName%/igm, user.first_name || '')
		.replace(/%lName%/igm, user.last_name || '')
		.replace(/%username%/igm, user.username || '');
	
	return sentQuestion(ctx, _text,
		[
			Markup.button.callback('✅ Принимаю правила', 'apply_rules', false)
		],
		3600000);
});

bot.on(['text', 'message', 'edited_message'], async(ctx) => {
	console.log('chat message');
	const message = ctx?.message || ctx?.update?.edited_message;
	const chat = message.chat;
	const user = message?.from;
	
	// const chat = await ctx.telegram.getChat(chatID);
	await addChat2DB(chat);
	
	// Проверяем наличие участника в БД
	await addUser2DB(user);
	
	//Получаем значение участника для чата
	const bNewUser = await getUserStateFromChat(chat, user);
	if(typeof(bNewUser) !== 'boolean'){
		// добавляем участника в чат как нового
		await addUser2Chat2DB(chat, user, true);
	}
	
	// Сохраняем сообщение
	addMessage2DB(ctx, chat, user, message).then();
	
	if(bNewUser !== false){
		await deleteMessage(ctx, message?.message_id);
		return sentQuestion(ctx,
			`${user?.first_name} ${user?.last_name}, Вы ещё не подтвердили принятие правил данного чата. Писать сообщения Вы сможете только после того, как примите правила.\n\nПеред тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`,
			[
				Markup.button.callback('✅ Принимаю правила', 'apply_rules', false)
			],
			5000
		);
	}
	
	for(let re of spam_rules || []){
		if(generateRegExp(re)?.test(message?.text)){
			console.log(`found spam message: ${message?.text}`);
			deleteMessage(ctx, message?.message_id).then();
			
			if(bannedUserID[message?.from?.id]){
				if(message?.chat?.type !== 'private'){
					await bot.telegram.banChatMember(message?.chat?.id, message.from.id, (message?.date + 3600));
					console.log(`User ${message.from.id} banned in ${message?.chat?.id}`);
				}
				
				delete bannedUserID[message?.from?.id];
				
			}else{
				bannedUserID[message?.from?.id] = true;
			}
			
			return sendAutoRemoveMsg(ctx,
				`${message?.from?.first_name || ''} ${message?.from.last_name || ''}${message?.from?.username ? ` (@${message.from.username})` : ''} — Первое и последнее предупреждение. В нашем канале нет места спаму.`,
				false,
				20000);
		}
	}
});

(async() => {
	try{
		console.info('Opening DB...');
		await db.open_db();
		console.info('DB is opened.');
		console.info('Testing connect to DB...');
		await db.query('SELECT 1;');
		console.info('Connect to DB was been tested.');
		
		
		console.info('Launch bot...');
		bot.launch().then();
		console.info('Bot is launching.');
		
	}catch(err){
		console.error(err);
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
