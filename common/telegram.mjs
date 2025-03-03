import {Markup, Telegraf} from 'telegraf';
import * as logger from './logger.mjs';
import * as telegram_db from "./telegram_db.mjs";
import markdownit from 'markdown-it';

//----------------------------------

const TELEGRAM_MAX_MESSAGE_LENGTH = parseInt(process.env.TELEGRAM_MAX_MESSAGES_LENGTH, 10) || 4000;
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
export const sendMessage = async(ctx, message, isMarkdown) => {
	try{
		const msg = [];
		if(isMarkdown){
			return parseMessageAndSaveByParts(ctx, message);
			
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
			msg.push(parseMessageAndSaveByParts(ctx, message, reply_to));
			
		}else{
			while(message){
				const mess_to_send = message.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH);
				message = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
				msg.push(ctx.sendMessage(mess_to_send, {reply_to_message_id: reply_to}));
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
export const sendAutoRemoveMsg = async(ctx, message, isMarkdown, timeout) => {
	const msg = sendMessage(ctx, message, isMarkdown);
	
	setTimeout(((ctx, msg) => async() => {
		msg = await msg;
		return deleteMessage(ctx, msg?.message_id);
	})(ctx, msg), timeout || TELEGRAM_TIMEOUT_TO_AUTOREMOVE_MESSAGE);
	
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
export const sentQuestion = async(ctx, question, buttons, timeout) => {
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
 * @param {Chat} chat
 * @param {User} user
 * @returns {Promise<Message.TextMessage>}
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
 * Парсинг и отправка сообщения по частям, в связи с ограничением API Telegram
 * @param {CTX}     ctx
 * @param {String}  message
 * @param {Number} [reply_to]
 * @returns {Promise<[Message.TextMessage]>}
 */
const parseMessageAndSaveByParts = async(ctx, message, reply_to) => {
	const md = markdownit();
	
	const parsed_message = md.parse(message);
	
	const msg = [];
	
	let _message = '';
	let prefix = '';
	let line_break = '';
	let bList = false;
	let entities = [];
	
	for(let i = 0; i < parsed_message.length; i++){
		const el = parsed_message[i];
		let new_message = '';
		let _entities = [];
		
		switch(el?.type){
			// Добавляем перевод строки
			case 'paragraph_open':  //Игнорируем
			case 'bullet_list_open':
			case 'list_item_close':
			case 'ordered_list_open':
				break;
			
			case 'paragraph_close':
			case 'heading_close':
				line_break += bList ? '' : '\n';
				bList = false;
				break;
			
			case 'bullet_list_close':
			case 'ordered_list_close':
				line_break += '\n';
				bList = false;
				break;
			
			// Добавляем признак заголовка как префикс. Этот признак надо учитывать только с последующим текстом заголовка
			case 'heading_open':
				prefix += el.markup + ' ';
				break;
			
			// Добавляем блок кода
			case 'fence':
				_entities.push({
					type:     'pre',
					offset:   new_message.length,
					length:   el.content.length,
					language: el.info
				});
				new_message += el.content;
				break;
			
			// Добавляем блок кода
			case 'list_item_open':
				prefix += line_break + '\n' + prefix + el.info + el.markup + ' ';
				line_break = '';
				bList = true;
				break;
			
			case 'hr':
				new_message += line_break + '\n' + prefix + el.markup + '\n';
				line_break = '';
				prefix = '';
				break;
			
			// Общий текст. Надо учесть предыдущий перевод строки и префиксы
			case 'inline':
				if(el.children && el.children.length){
					let _new_message = '';
					let __entities = [];
					
					let strong_open = 0;
					let italic_open = 0;
					let underline_open = 0;
					let stroke_open = 0;
					let link_open = 0;
					let URL = '';
					
					for(let j = 0; j < el.children.length; j++){
						const el_ch = el.children[j];
						switch(el_ch.type){
							case 'text':
								_new_message += el_ch.content;
								break;
							
							case 'code_inline':
								__entities.push({
									type:   'code',
									offset: _new_message.length,
									length: el_ch.content.length
								});
								_new_message += el_ch.content;
								break;
							
							case 'softbreak':
								_new_message += '/n';
								break;
							
							case 'strong_open':
								strong_open = _new_message.length;
								break;
							
							case 'strong_close':
								__entities.push({
									type:   'bold',
									offset: strong_open,
									length: _new_message.length - strong_open,
								});
								strong_open = 0;
								break;
							
							case 'italic_open':
								italic_open = _new_message.length;
								break;
							
							case 'italic_close':
								__entities.push({
									type:   'italic',
									offset: italic_open,
									length: _new_message.length - italic_open,
								});
								italic_open = 0;
								break;
							
							case 'stroke_open':
								stroke_open = _new_message.length;
								break;
							
							case 'stroke_close':
								__entities.push({
									type:   'strikethrough',
									offset: stroke_open,
									length: _new_message.length - stroke_open,
								});
								stroke_open = 0;
								break;
							
							case 'underline_open':
								underline_open = _new_message.length;
								break;
							
							case 'underline_close':
								__entities.push({
									type:   'underline',
									offset: underline_open,
									length: _new_message.length - underline_open,
								});
								underline_open = 0;
								break;
							
							case 'link_open':
								link_open = _new_message.length;
								URL = el_ch.attrs[0][1];
								break;
							
							case 'link_close':
								__entities.push({
									type:   'text_link',
									offset: link_open,
									length: _new_message.length - link_open,
									url:    URL
								});
								link_open = 0;
								break;
							
							case 'image':
								const alt = el_ch.attrs[1][1] || 'Изображение';
								__entities.push({
									type:   'text_link',
									offset: _new_message.length,
									length: alt.length,
									url:    el_ch.attrs[0][1]
								});
								_new_message += alt;
								break;
							
							default:
								console.warn(el_ch.type);
								console.dir(el_ch);
								
								_new_message += el_ch?.content || '';
								
								break;
						}
					}
					
					new_message = line_break + prefix;
					_entities = _entities.concat(__entities.map(el => {
						el.offset += new_message.length;
						return el;
					}));
					new_message += _new_message;
					
				}else{
					new_message += line_break + prefix + el.content;
				}
				
				prefix = '';
				line_break = '';
				break;
			
			case 'code_block':
				break;
			
			default:
				console.warn(el.type);
				console.dir(el);
				
				new_message += el.content || '';
				
				break;
		}
		
		if((_message + new_message).length > TELEGRAM_MAX_MESSAGE_LENGTH){
			// Превышение размера.
			// Отправляем часть сообщения и начинаем формировать новую строку для отправки
			
			if(reply_to){
				msg.push(ctx.sendMessage(_message, {entities: entities, reply_to_message_id: reply_to}));
				
			}else{
				msg.push(ctx.sendMessage(_message, {entities: entities}));
			}
			
			_message = new_message;     // Запоминаем неотправленную часть как новый аккумулятор
			entities = _entities;       // Запоминаем неотправленное оформление
			
		}else{  // Размер не превышен. Наращиваем строку для отправки и объединяем оформление с правильным смещением
			entities = entities.concat(_entities.map(el => {
				el.offset += _message.length;
				return el;
			}));
			_message += new_message;
		}
		
	}
	
	if(_message.length > 0){
		if(reply_to){
			msg.push(ctx.sendMessage(_message, {entities: entities, reply_to_message_id: reply_to}));
			
		}else{
			msg.push(ctx.sendMessage(_message, {entities: entities}));
		}
		
	}
	
	return msg;
};