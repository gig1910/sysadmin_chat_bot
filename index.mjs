import * as db from './common/db.mjs';
import * as logger from './common/logger.mjs';

import * as deepseek from './common/deepseek.mjs';

import * as telegram from './common/telegram.mjs';
import * as telegram_db from './common/telegram_db.mjs';

//-----------------------------

logger.info('Starting main').then();

//***************************************

telegram.bot.onerror = err => {
	logger.warn('bot - ERROR').then();
	logger.dir(err).then();
};

telegram.bot.start(/** @param {CTX} ctx */ async(ctx) => telegram.sendAutoRemoveMsg(ctx, 'Welcome'));

telegram.bot.help(/** @param {CTX} ctx */ async(ctx) => telegram.sendAutoRemoveMsg(ctx, 'Bot for telergam SysAdminChat'));

telegram.bot.command('getchatid', /** @param {CTX} ctx */ async(ctx) => {
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message?.message_id){
		/** @type {Chat} */ const chat = message?.chat;
		/** @type {From} */ const user = message?.from;
		
		telegram.deleteMessage(ctx, message?.message_id).then(); // Удаляем командное сообщение
		
		if(chat?.id && user?.id){
			return telegram.sendAutoRemoveMsg(ctx, `userID: ${user?.id}; chatID: ${chat?.id}`, false, 5000);
		}
	}
});

telegram.bot.command('question', /** @param {CTX} ctx */ async(ctx) => {
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message?.message_id){
		telegram.deleteMessage(ctx, message?.message_id).then(); // Удаляем командное сообщение
		
		return telegram.sendMessage(ctx,
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
			true
		);
	}
});

telegram.bot.command('deepseek_test_spam', /** @param {CTX} ctx */ async(ctx) => {
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message.message_id && message?.text){
		const arr = (/\/deepseek_test_spam (.*)/gmi).exec(message.text.replace(/\s+/igm, ' '));
		const answer = await deepseek.testMessage(arr ? arr[1] : message.text);
		
		return telegram.replyMessage(ctx,
			message.message_id,
			answer || 'NOT_ANSWER',
			false);
	}
});

telegram.bot.command('deepseek', /** @param {CTX} ctx */ async(ctx) => { deepseek.deepSeekTalks(ctx).then(); });

telegram.bot.action('apply_rules', /** @param {CTX} ctx */ async(ctx) => {
	const message = ctx?.update?.callback_query?.message;
	if(message){
		const chat = message.chat;
		const user = ctx?.update?.callback_query.from;
		
		if(chat?.id && user?.id){
			// Сохраняем сообщение
			telegram_db.addMessage2DB(ctx, chat, user, message).then();
			
			const userState = await telegram_db.getUserStateFromChat(chat, user);
			if(userState?.new_user === false){
				telegram.sendAutoRemoveMsg(ctx, `${telegram.makeName(user)}, Вам не требовалось отвечать на этот вопрос.`, false, 20000).then();
				
			}else{
				// Сбрасываем статус нового участника
				await Promise.all([
					telegram_db.addUser2Chat2DB(chat, user, false),
					telegram.sendAutoRemoveMsg(ctx, `Спасибо, ${telegram.makeName(user)}. Теперь Вы полноправный член группы.`, false, 20000)
				]);
			}
		}
	}
});

telegram.bot.on('new_chat_members', /** @param {CTX} ctx */ async(ctx) => {
	const arr = [];
	
	for(let i = 0; i < ctx?.message?.new_chat_members; i++){
		const user = ctx?.update?.message?.new_chat_members[i];
		arr.push(telegram.sendNewUserQuestion(ctx, user));
	}
	
	await Promise.all(arr);
});

telegram.bot.on('left_chat_member', /** @param {CTX} ctx */ async(ctx) => {
	const arr = [];
	logger.log('left_chat_member').then();
	
	const func = async(user) => {
		const message = ctx?.update?.message;
		const chat = message?.chat;
		
		await Promise.all([
			telegram_db.addChat2DB(chat),
			telegram_db.addUser2DB(user),
			telegram_db.removeUserFromChat2DB(chat?.id, user?.id)
		]);
		
		// Сохраняем сообщение
		return Promise.all([
			telegram_db.addMessage2DB(ctx, chat, user, message),
			telegram.deleteMessage(ctx, ctx?.message?.id)
		]);
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
telegram.bot.on([
	'text', 'message', 'edited_message', 'sticker', 'animation', 'audio', 'document', 'photo', 'video', 'video_note', 'voice',
	'channel_post', 'chat_member', 'chosen_inline_result', 'edited_channel_post', 'message_reaction', 'message_reaction_count',
	'my_chat_member', 'chat_join_request', 'contact', 'dice', 'location', 'users_shared', 'chat_shared'
], /** @param {CTX} ctx */ async(ctx) => {
	logger.log('chat message').then();
	/** @type {Message|Edited_Message} */ const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message.message_id){
		const chat = message.chat;
		const user = message.from;
		
		await Promise.all([
			telegram_db.addChat2DB(chat),
			telegram_db.addUser2DB(user)
		]);
		
		//Получаем значение участника для чата
		const userState = await telegram_db.getUserStateFromChat(chat, user);
		if(userState?.blocked){
			// Пользователь УЖЕ заблокирован. Просто удаляем его сообщение
			return telegram.deleteMessage(ctx, message.message_id);
			
		}else if(typeof (userState?.new_user) !== 'boolean'){
			// добавляем участника в чат как нового
			await telegram_db.addUser2Chat2DB(chat, user, true);
		}
		
		// Сохраняем сообщение
		telegram_db.addMessage2DB(ctx, chat, user, message).then();
		
		if(chat.id > 0){    // Личные сообщения
			
			// Получаем список 20 сообщений как диалог (сообщения по ответам) для нормального сохранения истории и скармливаем это DeepSeek
			// Ответ отправляем как ответ на сообщение, т.к. возможен разрыв в ответах, что бы понимать на что DeepSeek отвечал
			return deepseek.deepSeekTalks(ctx);
			
		}else{              // Сообщение в группу
			if(userState?.new_user !== false){
				// Обработка сообщения нового пользователя
				await telegram.deleteMessage(ctx, message.message_id);
				
				if(message?.text){
					
					//Отправляем сообщение на проверку на SPAM
					deepseek.isSpamMessage(ctx?.message?.text).then(async res => {
						if(res){
							// Просто удаляем пользователя как спамера
							return telegram.removeUserFromChat(ctx, chat, user);
						}
					});
					
					// Показываем приветственный текст с предложением принять правила группы
					return telegram.sendNewUserQuestion(ctx, user);
					
				}else{
					// Ну кто начинает "Общение" выкладывая сразу только картинку, видео, аудио или документ? СПАМЕР!!!!
					
					// Просто удаляем пользователя как спамера
					return telegram.removeUserFromChat(ctx, chat, user);
				}
				
			}else if(message?.reply_to_message){
				if(await telegram_db.hasDeepSeekTalkMarker(message?.reply_to_message?.message_id)){
					// Продолжаем диалог
					return deepseek.deepSeekTalks(ctx);
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
		telegram.bot.launch().then();
		logger.info('Bot is launching.').then();
		
		process_users_handler = setInterval(async() => { // Запуск процесса очистки группы от ботов, которые более чем 3 часа не отвечают на запрос принятия правил группы (запуск раз в полчаса)
			logger.info('Start interval function for clear chats...').then();
			
			logger.info('getting forgotten users from chats...').then();
			// Получаем список всех пользователей, которые отправили сообщение в чат или вошли в чат, но так и не приняли правила чата (99,9999% что это боты)
			const users = await telegram_db.getUsers(-1001325427983);
			
			for(let i = 0; i < users.rows.length; i++){
				const user = users.rows[i];
				if(user){
					logger.info(`Blocked user ${user.user_id} in chat ${user.chat_id}...`).then();
					telegram.removeUserFromChat(null, {id: user.chat_id}, {id: user.user_id}).then();
				}
			}
			
		}, 60000);
		
	}catch(err){
		logger.err(err).then();
		telegram.bot.stop('SIGINT');
		return db.close_db();
	}
})();

// Enable graceful stop
process.once('SIGINT', () => {
	telegram.bot.stop('SIGINT');
	return db.close_db();
});
process.once('SIGTERM', () => {
	telegram.bot.stop('SIGINT');
	return db.close_db();
});
