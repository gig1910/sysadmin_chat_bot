import {Telegraf} from 'telegraf';
import {generateRegExp} from './common/regexp.mjs';

console.log('Starting main');
const bot = new Telegraf(process.env.TOKEN);

let helloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

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
	
	let msg = await ctx.sendMessage(`userID: ${userId}; chatID: ${chatId}`);
	
	//Через 5 секунд уладяем ответ на команду
	setTimeout(((ctx, msg) => () => ctx.deleteMessage(msg.message_thread_id))(ctx, msg), 5000);
	
	return msg;
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

const spamTesters = [
	'арбитраж крипт валют',
	'став спорт',
	'зараб крипт',
	'работ день доход',
	'работ час доход',
	'работ доход день',
	'работ доход час',
	'работ инвестиц',
	'инвестиц вложен',
	'ТеСтОвОе СоОбЩеНиЕ нА сПаМ!!!'
];

bot.on(['text', 'message', 'edited_message'], async(ctx) => {
	console.log('chat message');
	// console.dir(ctx);
	const message = ctx?.message || ctx?.update?.edited_message;
	
	for(let re of spamTesters){
		if(generateRegExp(re)?.test(message?.text)){
			ctx.deleteMessage(message?.message_id);
			const mess = await ctx.reply(`${message?.from?.first_name || ''} ${message?.from.last_name || ''} (${message?.from?.username ? `@${message.from.username}` : ''}) - Первое и последнее предуплеждение. В нашем канале нет места спаму.`);
			setTimeout(((ctx, mess) => () => {
				ctx.deleteMessage(mess?.message_id);
			})(ctx, mess), 20000);
			break;
		}
	}
});

console.log('Launch bot...');
bot.launch();
console.log('Bot is launching.');

// Enable graceful stop
process.once('SIGINT', () => {
	bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
	bot.stop('SIGINT');
});
