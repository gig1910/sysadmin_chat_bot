import {Markup, Telegraf} from 'telegraf';
import * as logger from './logger.mjs';
import * as telegram_db from "./telegram_db.mjs";
import {parseMessageAndSaveByParts} from './parser.mjs';
//----------------------------------

const TELEGRAM_MAX_MESSAGE_LENGTH = parseInt(process.env.TELEGRAM_MAX_MESSAGE_LENGTH, 10) || 10000;
const TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE = parseInt(process.env.TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE, 10) || 10000;
const TELEGRAM_TIMEOUT_TO_DELETE_QUESTION = parseInt(process.env.TELEGRAM_TIMEOUT_TO_DELETE_QUESTION, 10) || 60000;

export const bot = new Telegraf(process.env.TOKEN);

const HelloText = `Привет, %fName% %lName% (@%username%).
Добро пожаловать в чат "Системный Администратор"

Перед тем как написать вопрос прочти, пожалуйста, правила группы в закреплённом сообщении https://t.me/sysadminru/104027`;

export const makeName = (user) => `${user?.first_name ? user?.first_name : ''}${user?.last_name ? (user?.first_name ? ' ' : '') + user?.last_name : ''}`;

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
				message = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
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
				message = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
				msg.push(ctx.sendMessage(mess_to_send, {reply_to_message_id: reply_to}));
			}
		}
		
		return msg;
		
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
		msg = await Promise.all(msg);
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
	const message = ctx?.update?.message;
	if(message?.message_id){
		const chat = message?.chat;
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
