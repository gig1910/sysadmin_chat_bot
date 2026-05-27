import {Markup, Telegraf}           from 'telegraf';
import * as logger                  from './logger.mjs';
import {parseMessageAndSaveByParts} from './parser.mjs';
import * as telegram_db             from "./telegram_db.mjs";
import telegram                     from "telegraf/src/telegram";
//----------------------------------

const TELEGRAM_MAX_MESSAGE_LENGTH            = parseInt(process.env.TELEGRAM_MAX_MESSAGE_LENGTH, 10) || 10000;
const TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE = parseInt(process.env.TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE, 10) || 10000;
const TELEGRAM_TIMEOUT_TO_DELETE_QUESTION    = parseInt(process.env.TELEGRAM_TIMEOUT_TO_DELETE_QUESTION, 10) || 60000;

const ADMIN_STATUSES = new Set(["creator", "administrator"]);

//----------------------------------

if(!process.env.TOKEN){ throw new Error('Not defined ENV BOT TOKEN'); }

export const bot = new Telegraf(process.env.TOKEN);

const HelloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

export const makeName = (user) => `${user?.first_name ? user?.first_name : ''}${user?.last_name ? (user?.first_name ? ' ' : '') + user?.last_name : ''}`;

/**
 * Получение сообщения из CTX
 * @param {CTX} ctx
 * @returns {Message|null}
 */
export const getCtxMessage = (ctx) => ctx?.update?.message || ctx?.update?.edited_message || null;

/**
 * Получение данных чата из CTX
 * @param {CTX} ctx
 * @returns {Chat|null}
 */
export const getChatFromCtx = (ctx) => getCtxMessage(ctx)?.chat;

/**
 * Получение данных чата из CTX
 * @param {CTX} ctx
 * @returns {User|null}
 */
export const getUserFromCtx = (ctx) => getCtxMessage(ctx)?.from;

/**
 * Удаление сообщения
 * @param {CTX}    ctx
 * @param {Number} msg_id
 * @returns {Promise<Boolean>}
 */
export const deleteMessage = async(ctx, msg_id) => {
	try{
		return await ctx.deleteMessage(msg_id);

	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка сообщений
 * @param {CTX}      ctx
 * @param {String}   message
 * @param {Boolean} [isMarkdown = false]
 * @returns {Promise<[Message.TextMessage]>}
 */
export const sendMessage = (ctx, message, isMarkdown) => {
	try{
		const msg = [];
		if(isMarkdown){
			parseMessageAndSaveByParts(message)?.forEach((message) => {
				if(message?.message){
					msg.push(ctx.sendMessage(message.message, {entities: message?.entities}));
				}
			});

		}else{
			while(message){
				const mess_to_send = message.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH);
				message            = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
				msg.push(ctx.sendMessage(mess_to_send));
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
 * @returns {Promise<[Message.TextMessage]>}
 */
export const replyMessage = async(ctx, reply_to, message, isMarkdown) => {
	try{
		const msg = [];

		if(isMarkdown){
			parseMessageAndSaveByParts(message)?.forEach((message) => {
				if(message?.message){
					msg.push(ctx.sendMessage(message.message, {entities: message?.entities, reply_to_message_id: reply_to}));
				}
			});

		}else{
			while(message){
				const mess_to_send = message.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH);
				message            = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
				msg.push(ctx.sendMessage(mess_to_send, {reply_to_message_id: reply_to}));
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
 * @param {Number}   chat_id
 * @param {Number}   message_id
 * @param {String}   message
 * @param {Boolean} [isMarkdown = false]
 * @returns {Promise<[Message.TextMessage]>}
 */
export const editMessage = (ctx, chat_id, message_id, message, isMarkdown) => {
	try{
		const msg = [];
		if(isMarkdown){
			logger.warn('Редактирование возможно только одного сообщения, без парсинга').then();
			/*parseMessageAndSaveByParts(message)?.forEach((message) => {
				if(message?.message){
					msg.push(ctx.sendMessage(message.message, {entities: message?.entities}));
				}
			});*/

		}else{
			message = message.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH);
			return ctx.telegram.editMessageText(chat_id, message_id, undefined, message);
		}

	}catch(err){
		logger.warn(err).then();
	}
};

/**
 * Отправка авто-удаляемого сообщения
 * @param {CTX}      ctx
 * @param {String}   message
 * @param {Boolean} [isMarkdown=false]
 * @param {Number}  [timeout=TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE]
 * @return {Promise<[Message.TextMessage]>}
 */
export const sendAutoRemoveMsg = async(ctx, message, isMarkdown, timeout) => {
	const msg = sendMessage(ctx, message, isMarkdown);

	setTimeout(((ctx, msg) => async() => {
		msg       = await Promise.all(msg);
		const res = [];
		msg.forEach(msg => res.push(deleteMessage(ctx, msg?.message_id)));
		return res;
	})(ctx, msg), timeout || TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE);

	return msg;
};

/**
 * Отправка вопроса с кнопками ответа
 * @param {CTX}      ctx
 * @param {String}   question
 * @param {Array}    buttons
 * @return {Promise<Message.TextMessage>}
 */
export const sentQuestion = async(ctx, question, buttons) => {
	return ctx.reply(
		question,
		Markup.inlineKeyboard([buttons]).oneTime().resize()
	);
};

export const sendNewUserQuestion = async(ctx, user) => {
	const message = getCtxMessage(ctx);
	if(message?.message_id){
		const chat = getChatFromCtx(ctx);
		if(chat?.id){
			// const chat = await ctx.telegram.getChat(chatID);
			await Promise.all([
				telegram_db.addChat2DB(chat),
				telegram_db.addUser2DB(user)
			]);

			await Promise.all([
				telegram_db.addUser2Chat2DB(chat, user, true),
				telegram_db.addMessage2DB(ctx, chat, user, message).then()
			]);

			const _text = (HelloText || '')
				.replace(/%fName%/igm, user.first_name || '')
				.replace(/%lName%/igm, user.last_name || '')
				.replace(/%username%/igm, user.username || '');

			const _buttons = [];
			let bAccept    = false;
			for(let i = 0; i < 3; i++){
				const bTrue = (Math.random() >= 0.5);
				if(!bAccept && (bTrue || i > 1)){
					_buttons.push(Markup.button.callback('Принимаю правила', 'apply_rules', false));
					bAccept = true;

				}else{
					_buttons.push(Markup.button.callback((Math.random() >= 0.5) ? 'Не принимаю правила' : 'Я бот', 'reject_rules', false));
				}
			}

			const msg = sentQuestion(ctx, _text, _buttons);

			setTimeout(((ctx, msg) => async() => {
				msg = await msg;
				return deleteMessage(ctx, msg?.message_id);
			})(ctx, msg), TELEGRAM_TIMEOUT_TO_DELETE_QUESTION);

			return msg;
		}
	}
};

/**
 * @param {?CTX} ctx
 * @param {Chat|{id: Number}} chat
 * @param {User|{id: Number}} user
 * @returns {Promise<[Message.TextMessage]>}
 */
export const removeUserFromChat = async(ctx, chat, user) => {
	logger.info(`Blocked user ${user?.id} in chat ${chat?.id}...`).then();

	await Promise.all([
		bot.telegram.banChatMember(chat?.id, user?.id),
		telegram_db.removeUserFromChat2DB(chat?.id, user?.id),
	]);

	if(ctx){
		return sendAutoRemoveMsg(ctx, `Участник ${makeName(user)} удалён как спамер.`);
	}
};

/**
 * Проверка? что вызов был из группы или супер-группы
 * @param {CTX} ctx
 * @returns {Boolean}
 */
export const isGroupChat = (ctx) => {
	const chat = getChatFromCtx(ctx);
	return ['group', 'supergroup'].includes(chat?.type);
}

/**
 * Проверяет, что сообщение отправлено анонимным админом от имени группы.
 * В Telegram такие сообщения приходят с sender_chat.id === chat.id.
 *
 * @param {CTX} ctx
 * @returns {Boolean}
 */
export const isAnonymousChatAdmin = (ctx) => {
	const message = getCtxMessage(ctx);

	return Boolean(
		message?.sender_chat?.id && message?.chat?.id && message.sender_chat.id === message.chat.id
	);
}

/**
 * Проверяет, является ли пользователь админом текущего чата
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
export const isCurrentUserChatAdmin = async(ctx) => {
	if(!isGroupChat(ctx)){
		return false;
	}

	if(isAnonymousChatAdmin(ctx)){
		return true;
	}

	if(!ctx.from?.id || ctx.from?.is_bot){
		return false;
	}

	const member = await ctx.getChatMember(ctx.from.id);

	return ADMIN_STATUSES.has(member.status);
}

/**
 * Guard для команд, доступных только админам группы
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
export const requireChatAdmin = async(ctx) => {
	if(!isGroupChat(ctx)){
		await sendAutoRemoveMsg(ctx, 'Команда доступна только в группе или супергруппе.');
		return false;
	}

	let isAdmin = false;

	try{
		isAdmin = await isCurrentUserChatAdmin(ctx);

	}catch(error){
		logger.error("Failed to check chat admin:", error).then();
		await sendAutoRemoveMsg(ctx, 'Не удалось проверить права администратора. Проверь, что бот добавлен в чат и имеет права администратора.');

		return false;
	}

	if(!isAdmin){
		await sendAutoRemoveMsg(ctx, 'Команда доступна только администраторам чата.');
		return false;
	}

	return true;
}