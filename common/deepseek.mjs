import OpenAI        from "openai";
import logger        from "./logger.mjs";
import * as telegram from "./telegram.mjs";
import * as telegram_db from "./telegram_db.mjs";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

let openai;
if(DEEPSEEK_API_KEY){
	openai = new OpenAI({
		baseURL: 'https://api.deepseek.com',
		apiKey:  process.env.DEEPSEEK_API_KEY,
		timeout: 10 * 60 * 1000, // 10 минут
	});
}

/**
 * Тест сообщения на SPAM
 * @param {String} message
 * @returns {Promise<Boolean>}
 */
export async function isSpamMessage(message){
	if(!openai) {
		logger.warn('DeepSeek API key is not set').then();
		return false;
	}

	try{
		// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
		
		logger.log(`Тест сообщения на спам "${message}"`).then();
		
		const completion = await openai.chat.completions.create({
			messages: [{
				role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
			}, {
				role: 'user', content: message
			}],
			model:    'deepseek-reasoner',
		});
		
		logger.log(completion.choices[0].message.content).then();
		
		return completion.choices[0].message.content.toUpperCase().includes('YES');
		
	}catch(err){
		logger.err(err).then();
		
		return false;
	}
}

/**
 *
 * @param {String} message
 * @returns {Promise<?String>}
 */
export async function testMessage(message){
	if(!openai) {
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	try{
		// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
		
		logger.log(`Тест сообщения на спам "${message}"`).then();
		const completion = await openai.chat.completions.create({
			messages:    [{
				role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
			}, {
				role: 'user', content: message
			}],
			model:       'deepseek-chat',
			temperature: 1.3,
		});
		
		return completion.choices[0].message.content;
		
	}catch(err){
		logger.err(err).then();
		
		return '';
	}
}

/**
 * Отправка сообщения в DeepSeek
 * @param {Object} messages
 * @returns {Promise<Object>}
 */
export async function sendMessages(messages){
	if(!openai) {
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	if(messages?.length > 0){
		try{
			logger.log(`Отправка сообщений:"`).then();
			logger.dir(messages).then();
			const completion = await openai.chat.completions.create({
				messages: [{
					role:    'system',
					content: 'Отвечай на русском языке используя разметку `markdown`. Выдавай краткий ответ если иное не уточняется в вопросе. Не выдумывай, используй только проверенные источники информации. Если есть сомнения в вопросе или ответе - задавай уточняющие вопросы.'
				}].concat(messages),
				model:       'deepseek-chat',
				temperature: 1.5,
			});
			
			logger.trace(`Ответ:`).then();
			logger.dir(completion?.choices[0]?.message).then();
			return completion?.choices[0]?.message;
			
		}catch(err){
			logger.err(err).then();
			
			return '';
		}
	}
}

// ------------------------------------------------

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekTalks = async(ctx) => {
	if(!openai) {
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message?.message_id && message?.text){
		// Очистка запроса от текста команды
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			const chat = message.chat;
			const user = message.from;

			const text = message.text.replace(/^\/deepseek(?:@\w+)?\s*/igm, '').trim();
			if(text){

				// Сохраняем сообщение (Тут надо дождаться что бы из БД получить сразу весь диалог, включая ЭТО сообщение)
				await telegram_db.addMessage2DB(ctx, chat, user, message);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesReplyLink(ctx?.botInfo?.id, message.chat?.id, message.message_id);

				if(messages?.length > 0){
					// Запрашиваем ответ у DeepSeek

					// Уведомляем что получили запрос и начали готовить ответ
					let _symb             = `🔃️`;
					const _mess           = await telegram.replyMessage(ctx, message?.message_id, `${_symb} Минутку... Готовлю ответ...`, false);
					const updater_handler = setInterval(async() => {
						const mess_id = (await _mess[0])?.message_id;
						switch(_symb){
							case '🔃️':
								_symb = '🔄';
								break;
							default:
								_symb = '🔃️';
								break;
						}
						return telegram.editMessage(ctx, message?.chat?.id, mess_id, `${_symb} Минутку... Готовлю ответ...`, false);
					}, 2000);

					const answer = await sendMessages(messages);

					// Останавливаем обновление сообщения
					clearInterval(updater_handler);

					// Удаляем уведомление о подготовке ответа
					for(let i = 0; i < _mess?.length; i++){
						const mess_id = (await _mess[i])?.message_id;
						telegram.deleteMessage(ctx, mess_id).then();
					}

					if(answer){
						// Отправляем ответ DeepSeek как ответ на сообщение
						let mess = await telegram.replyMessage(ctx, message?.message_id, answer?.content, true);
						Promise.all(mess).then(mess => {
							mess?.forEach(m => {
								if(m?.message_id){
									ctx.update.message = m;
									//Сохраняем ответ DeepSeek в БД для получения полноценного диалога, но только если смогли отправить ответ в телеграм
									telegram_db.addMessage2DB(ctx, chat, botInfo, m).then();
								}
							});
						});

						return mess;
					}

				}else{
					logger.warn('Нет сообщений на отправку в DeepSeek').then();
				}

			}else{
				let mess = await telegram.replyMessage(ctx, message?.message_id, 'Привет, я бот-помошник.\n\nЯ могу попробовать ответить на твой вопрос, но для этого Вы должны его задать используя или ответ на это сообщение, или используя формат `/deepseek ВОПРОС`\n\nВы так же можете давать ответ на сообщение в цепочке обсуждения которого есть вопрос ко мне, я тогда проанализирую всю цепочку вопросов-ответов и выдам более релевантный результат.', true);
				Promise.all(mess).then(mess => {
					mess?.forEach(m => {
						if(m?.message_id){
							ctx.update.message = m;
							//Сохраняем ответ DeepSeek в БД для получения полноценного диалога, но только если смогли отправить ответ в телеграм
							telegram_db.addMessage2DB(ctx, chat, botInfo, m).then();
						}
					});
				});

				return mess;
			}
		}
	}
};

