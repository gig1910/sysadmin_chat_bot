import {Telegraf} from 'telegraf';
import {generateRegExp} from './common/regexp.mjs';

import {spam_rules} from './spam_rules/index.mjs';

console.info('Starting main');
const bot = new Telegraf(process.env.TOKEN);

let helloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

const bannedUserID = {};

/**
 * @param {Object}  ctx
 * @param {String}  message
 * @param {Number} [timeout=1000]
 * @return {Promise<*>}
 */
const sendAutoRemoveMsg = async(ctx, message, timeout) => {
	let msg = await ctx.sendMessage(message);
	
	setTimeout(((ctx, msg) => () => {
		try{
			ctx.deleteMessage(msg?.message_id);
		} catch(err){
			console.warn(err.message || err);
		}
	})(ctx, msg), timeout || 1000);
	
	return msg;
};

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
	
	return sendAutoRemoveMsg(ctx, `userID: ${userId}; chatID: ${chatId}`, 5000);
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

bot.on('new_chat_members', (ctx) => {
	console.log('new_chat_members');
	
	ctx.deleteMessage(ctx?.message?.id);
	
	const new_user = ctx?.message?.new_chat_member;
	const from = ctx?.message?.from;
	console.dir(new_user);
	if(new_user){
		// send a message to the chat acknowledging receipt of their message
		const _text = (helloText || '')
			.replace(/%fName%/igm, new_user.first_name || '')
			.replace(/%lName%/igm, new_user.last_name || '')
			.replace(/%username%/igm, from.username || '');
		
		return sendAutoRemoveMsg(ctx, _text, 3600000); // Час
	}
});

bot.on(['text', 'message', 'edited_message'], async(ctx) => {
	console.log('chat message');
	const message = ctx?.message || ctx?.update?.edited_message;
	
	for(let re of spam_rules || []){
		if(generateRegExp(re)?.test(message?.text)){
			console.log(`found spam message: ${message?.text}`);
			ctx.deleteMessage(message?.message_id);

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
				`${message?.from?.first_name || ''} ${message?.from.last_name || ''} (${message?.from?.username ? `@${message.from.username}` : ''}) - Первое и последнее предупреждение. В нашем канале нет места спаму.`,
				20000);
		}
	}
});

console.info('Launch bot...');
bot.launch().then();
console.info('Bot is launching.');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGINT'));
