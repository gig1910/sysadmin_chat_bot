const {Telegraf} = require('telegraf');

console.log('Starting main');
const bot = new Telegraf(process.env.TOKEN);

let helloText = `Привет %fName% %lName% (@%username%).
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

// Matches "/echo [whatever]"
/*
 bot.command('setHelloText', async(ctx) => {
 console.log('onText');
 console.dir(ctx);
 
 // 'msg' is the received Message from Telegram
 // 'match' is the result of executing the regexp above on the text content
 // of the message
 
 const chatId = ctx?.chat?.id;
 const userId = ctx.from.id;
 const text   = ctx?.message; // the captured "whatever"
 
 //Получаем администратороа чата
 const admins = (await bot.getChatAdministrators(chatId)) || [];
 const _b     = admins.find((el) => el?.user?.id === userId);
 if(_b && text){
 // Админ устанавливаем текст-приветствия и удаляем команду.
 helloText = text;
 let msg   = await bot.sendMessage(chatId, 'Ok');
 
 //Через 5 секунд уладяем ответ на команду
 setTimeout(((msg) => () => bot.deleteMessage(msg.chat_id, msg.message_thread_id))(msg), 5000);
 }
 
 return bot.deleteChatPhoto(msg.message_id);
 });
 */

bot.command('getchatid', async(ctx) => {
	const chatId = ctx?.chat?.id;
	const userId = ctx.from.id;
	
	let msg   = await bot.sendMessage(chatId, `userID: ${userId}; chatID: ${chatId}`);
	
	//Через 5 секунд уладяем ответ на команду
	setTimeout(((msg) => () => bot.deleteMessage(msg.chat_id, msg.message_thread_id))(msg), 5000);
	
	return bot.deleteChatPhoto(msg.message_id);
});

bot.on('new_chat_members', (ctx) => {
	console.log('new_chat_members');
	console.dir(ctx);
	
	const new_user = ctx?.message?.new_chat_member;
	const from = ctx?.message?.from;
	console.dir(new_user);
	if(new_user){
		// send a message to the chat acknowledging receipt of their message
		const _text = (helloText || '')
			.replace(/%fName%/igm, new_user.first_name)
			.replace(/%lName%/igm, new_user.last_name)
			.replace(/%username%/igm, from.username);
		
		ctx.reply(_text);
	}
});

console.log('Launch bot...');
bot.launch();
console.log('Bot is launching.');

// Enable graceful stop
process.once('SIGINT', () => {
	bot.stop('SIGINT');
	imap_connection && imap_connection.end();
});

process.once('SIGTERM', () => {
	clearInterval(_tId);
	bot.stop('SIGTERM');
	imap_connection && imap_connection.end();
});
