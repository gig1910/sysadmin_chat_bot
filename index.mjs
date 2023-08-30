import {Telegraf} from 'telegraf';
import {generateRegExp} from './common/regexp.mjs';

import {spam_rules} from './spam_rules/index.mjs';

console.info('Starting main');
const bot = new Telegraf(process.env.TOKEN);

let helloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

/**
 * @param ctx
 * @param message
 * @param timeout
 * @return {Promise<*>}
 */
const sendAutoRemoveMsg = async(ctx, message, timeout) => {
	let msg = await ctx.sendMessage(message);
	
	setTimeout(((ctx, msg) => () => ctx.deleteMessage(msg?.message_id))(ctx, msg), timeout);
	
	return msg;
};

//***************************************

bot.onerror = err => {
	console.warn('bot - ERROR');
	console.dir(err);
};

bot.start((ctx) => {
	console.dir(ctx);
	return ctx.reply('Welcome');
});

bot.help((ctx) => {
});

bot.command('getchatid', async(ctx) => {
	const chatId = ctx?.chat?.id;
	const userId = ctx.from.id;
	
	return sendAutoRemoveMsg(ctx, `userID: ${userId}; chatID: ${chatId}`, 5000);
});

bot.on('new_chat_members', (ctx) => {
	console.log('new_chat_members');
	// console.dir(ctx);
	
	const new_user = ctx?.message?.new_chat_member;
	const from = ctx?.message?.from;
	console.dir(new_user);
	if(new_user){
		// send a message to the chat acknowledging receipt of their message
		const _text = (helloText || '')
			.replace(/%fName%/igm, new_user.first_name || '')
			.replace(/%lName%/igm, new_user.last_name || '')
			.replace(/%username%/igm, from.username || '');
		
		ctx.reply(_text);
	}
});

bot.on(['text', 'message', 'edited_message'], async(ctx) => {
	console.log('chat message');
	// console.dir(ctx);
	const message = ctx?.message || ctx?.update?.edited_message;
	
	for(let re of spam_rules || []){
		if(generateRegExp(re)?.test(message?.text)){
			ctx.deleteMessage(message?.message_id);
			return sendAutoRemoveMsg(ctx,
				`${message?.from?.first_name || ''} ${message?.from.last_name || ''} (${message?.from?.username ? `@${message.from.username}` : ''}) - Первое и последнее предуплеждение. В нашем канале нет места спаму.`,
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
