import OpenAI           from 'openai';
import logger           from './logger.mjs';
import * as telegram    from './telegram.mjs';
import * as telegram_db from './telegram_db.mjs';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

let openai;
if(DEEPSEEK_API_KEY){
	openai = new OpenAI({
		baseURL: 'https://api.deepseek.com',
		apiKey:  process.env.DEEPSEEK_API_KEY,
		timeout: 10 * 60 * 1000, // 10 минут
	});
}

const IS_SPAM            = 1;
const IS_MESSAGE         = 2;
const IS_TEST_MESSAGE    = 3;
const IS_SUMMARY_MESSAGE = 4;
const AI_MODEL_REASONER  = 1;
const AI_MODEL_CHAT      = 2;

const AI_CHAT_MODEL     = 'deepseek-v4-flash';
const AI_REASONER_MODEL = 'deepseek-v4-pro';

export const AI_ID = 1;

/**
 * Отправка сообщения в DeepSeek
 * @param {CTX} ctx
 * @param {Number} ai_id
 * @param {Object} messages
 * @param {Number} chat_id
 * @param {Boolean} [analyse = false]
 * @param {Number}  [queryType= {{IS_MESSAGE}}]
 * @param {String} [systemPrompt]
 * @returns {Promise<Object>}
 */
export async function sendMessages2AI(ctx, ai_id, messages, chat_id, analyse, queryType, systemPrompt){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	if(messages?.length > 0){
		// Сохраняем запрос в БД
		const _id = await telegram_db.insertAIRequest(ai_id, queryType, AI_MODEL_CHAT, messages);

		logger.log(`Отправка сообщений:'`).then();
		logger.log(`ID: ${_id}`).then();

		// Получаем блок настроек для чата/AI (Если сознательно не передали свой)
		let temperature = 1;
		if(!systemPrompt){
			(await telegram_db.getChatAISettings(ctx, ai_id, !!analyse))
				?.rows?.map(row => {
				switch(row.type){
					case 'SYSTEM_PROMPT':
						systemPrompt = row.value;
						break;

					case 'TEMPERATURE':
						temperature = parseFloat(row.value);
						if(!Number.isFinite(temperature)){
							temperature = analyse ? 1 : 0.85;
						}
						break;
				}
			});
		}

		if(systemPrompt){
			// Есть системный промпт. Добавляем его в запрос
			messages = [{role: 'system', content: systemPrompt}].concat(messages);
		}

		// Отправка запроса AI
		try{
			const aiParams = {
				messages,
				model:       AI_CHAT_MODEL,
				temperature: temperature || 0.85,
			};

			if(!!analyse){
				aiParams.thinking         = {'type': 'enabled'};
				aiParams.reasoning_effort = 'high';
				aiParams.temperature      = temperature || 1;
			}

			logger.trace(aiParams).then();

			const completion = await openai.chat.completions.create(aiParams);
			const _answer    = completion.choices[0].message;

			// Сохраняем ответ от AI
			telegram_db.updateAIRequest(_id, completion).then();

			logger.trace(`Ответ:`).then();
			logger.dir(_answer).then();

			return _answer;

		}catch(err){
			logger.err(err).then();
			if(_id){
				// Сохраняем ошибку от AI
				telegram_db.updateAIRequest(_id, null, err).then();
			}

			return null;
		}
	}
}


/**
 * Отображение уведомления? что ответ у АИ запрошен
 * @param {CTX} ctx
 * @returns {Promise<?{ctx: CTX, mess: [Message.TextMessage], updater_handler: Number}>}
 * @async
 */
async function showWaitMessage(ctx){
	if(ctx){
		const res = {};

		const message = telegram.getCtxMessage(ctx);
		const chat    = telegram.getChatFromCtx(ctx);

		let _symb           = `🔃️`;
		res.ctx             = ctx;
		res.mess            = await telegram.replyMessage(ctx, message?.message_id, `${_symb} Минутку... Готовлю ответ...`, false);
		res.updater_handler = setInterval(async() => {
			const mess_id = (await res.mess[0])?.message_id;
			switch(_symb){
				case '🔃️':
					_symb = '🔄';
					break;
				default:
					_symb = '🔃️';
					break;
			}
			return telegram.editMessage(ctx, chat?.id, mess_id, `${_symb} Минутку... Готовлю ответ...`, false);
		}, 4000);

		return res;
	}
}

/**
 * Удаление сообщения-уведомления
 * @param {{ctx: CTX, mess: [Message.TextMessage], updater_handler: Number}} waitMessageStruct
 * @returns {Promise<void>}
 * @async
 */
async function hideWaitMessage(waitMessageStruct){
	if(waitMessageStruct){
		// Останавливаем обновление сообщения
		clearInterval(waitMessageStruct.updater_handler);

		// Удаляем уведомление о подготовке ответа
		for(let i = 0; i < waitMessageStruct.mess?.length; i++){
			const mess_id = (await waitMessageStruct.mess[i])?.message_id;
			telegram.deleteMessage(waitMessageStruct.ctx, mess_id).then();
		}
	}
}

/**
 * Отправка ответа от AI
 * @param {CTX} ctx
 * @param {Object} answer
 * @returns {Promise<Message.TextMessage[]>}
 */
async function sendAnswerIA(ctx, answer){
	// Обработка ответа
	const message = telegram.getCtxMessage(ctx);
	if(message?.message_id){
		const botInfo = ctx?.botInfo;
		const chat    = message.chat;

		let mess;
		if(answer){
			// Отправляем ответ DeepSeek как ответ на сообщение
			mess = await telegram.replyMessage(ctx, message?.message_id, answer?.content, true);
			Promise.all(mess).then(mess => {
				mess?.forEach(m => {
					if(m?.message_id){
						ctx.update.message = m;
						//Сохраняем ответ DeepSeek в БД для получения полноценного диалога, но только если смогли отправить ответ в телеграм
						telegram_db.addMessage2DB(ctx, chat, botInfo, m).then();
					}
				});
			});


		}else{ // Нет ответа, т.к. ошибка
			mess = await telegram.replyMessage(ctx, message?.message_id, 'Ошибка при запросе у DeepSeek.\nПовторите запрос позднее...', true);
			Promise.all(mess).then(mess => {
				mess?.forEach(m => {
					if(m?.message_id){
						ctx.update.message = m;
						//Сохраняем ответ DeepSeek в БД для получения полноценного диалога, но только если смогли отправить ответ в телеграм
						telegram_db.addMessage2DB(ctx, chat, botInfo, m).then();
					}
				});
			});
		}

		return mess;
	}
}

/**
 * Отправка ответа-справки от AI
 * @param {CTX} ctx
 * @returns {Promise<Message.TextMessage[]>}
 */
async function sendHelpMessageIA(ctx){
	// Обработка ответа
	const message = telegram.getCtxMessage(ctx);
	if(message?.message_id){
		const botInfo = ctx?.botInfo;
		const chat    = message.chat;

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

// ------------------------------------------------

/**
 * Тест сообщения на SPAM
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
export async function isSpamMessage(ctx){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return false;
	}

	const message = telegram.getCtxMessage(ctx)?.text;
	if(message){
		const chat = telegram.getChatFromCtx(ctx);

		logger.log(`Тест сообщения на спам '${message}'`).then();

		const _messages = [{role: 'user', content: message}];

		const spamPrompt = (await telegram_db.getChatAISettings(ctx, AI_ID, false, 'TEST_SPAM_PROMPT'))?.rows?.[0]?.value ||
		                   'Check the message and answer only YES or NO if the message looks like SPAM';
		const _answer    = await sendMessages2AI(ctx, AI_ID, _messages, chat?.id, false, IS_SPAM, spamPrompt);

		return _answer?.content?.toUpperCase().includes('YES');
	}

	return false;
}

/**
 * Тест сообщения на спам (отработка команды бота)
 * @param {CTX} ctx
 * @returns {Promise<?String>}
 */
export async function testMessage(ctx){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	/** @type {Message|Edited_Message} */ const message = telegram.getCtxMessage(ctx);
	if(message?.message_id && message?.text){
		const chat = message.chat;

		const arr = (/\/deepseek_test_spam (.*)/gmi).exec(message.text.replace(/\s+/igm, ' '));
		if(arr?.[1]){
			const _messages = [{role: 'user', content: arr[1]}];

			const spamPrompt = (await telegram_db.getChatAISettings(ctx, AI_ID, false, 'TEST_SPAM_PROMPT'))?.rows?.[0]?.value ||
			                   'Check the message and answer only YES or NO if the message looks like SPAM';
			const _answer    = await sendMessages2AI(ctx, AI_ID, _messages, chat?.id, false, IS_TEST_MESSAGE, spamPrompt);

			return _answer?.content?.toUpperCase().includes('YES') ? 'YES' : 'NO';
		}
	}
}

// ------------------------------------------------

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @param {Boolean} [analyse] - Флаг режима анализа
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekTalks = async(ctx, analyse) => {
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	const message = telegram.getCtxMessage(ctx);
	console.log('message');
	console.log(message);
	if(message && message?.message_id && message?.text){
		// Очистка запроса от текста команды
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			const chat = message.chat;
			const user = message.from;

			const text = message.text.replace(/^\/deepseek(?:_analyse)?(?:@\w+)?\s+/igm, '').trim();
			console.log('message.text');
			console.log(message.text);
			console.log('text');
			console.log(text);
			if(text){

				// Сохраняем сообщение (Тут надо дождаться, чтобы из БД получить сразу весь диалог, включая ЭТО сообщение)
				await telegram_db.addMessage2DB(ctx, chat, user, message).catch(console.error);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesReplyLink(ctx?.botInfo?.id, chat?.id, message.message_id);
				console.log('messages');
				console.log(messages);

				if(messages?.length > 0){
					// Уведомляем, что получили запрос и начали готовить ответ
					const _waitMessage = await showWaitMessage(ctx);

					// Запрашиваем ответ у DeepSeek
					const answer = await sendMessages2AI(ctx, AI_ID, messages, chat.id, !!analyse, IS_MESSAGE);

					// Останавливаем обновление сообщения
					await hideWaitMessage(_waitMessage);

					// Отправляем ответ
					return sendAnswerIA(ctx, answer);

				}else{
					logger.warn('Нет сообщений на отправку в DeepSeek').then();
				}

			}else{
				// Отправляем ответ-справку
				return sendHelpMessageIA(ctx);
			}
		}
	}
};

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekSummary = async(ctx) => {
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	const message = telegram.getCtxMessage(ctx);
	if(message && message?.message_id && message?.text){
		// Очистка запроса от текста команды
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			const chat = message.chat;
			const user = message.from;

			const text = message.text.replace(/^\/deepseek_summary(?:@\w+)?\s*/igm, '').trim().replace(/\n/igm, '\\n') || '2h';
			if(text){
				const re   = /(?:(\d+)([hmd]))?(.*)/igm;
				const arr  = re.exec(text);
				let amount = 2;
				let period = 'h';
				if(arr?.length){
					amount = parseInt(arr[1], 10);
					period = arr[2].toLowerCase();
				}

				let interval;
				switch(period){
					case 'm':
						interval = `${amount} MINUTE`;
						break;
					case 'h':
						interval = `${amount} HOUR`;
						break;
					case 'd':
						interval = `${amount} DAY`;
						break;
					default:
						interval = `2 HOUR`;
						break;
				}

				const add_query = (arr[3] ?? '').replace(/\\n/igm, '\n');


				// Сохраняем сообщение (Тут надо дождаться, чтобы из БД получить сразу весь диалог, включая ЭТО сообщение)
				await telegram_db.addMessage2DB(ctx, chat, user, message).catch(console.error);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesFromChatByInterval(message.chat?.id, ctx?.botInfo?.id, interval);
				if(messages?.length > 0){
					const summaryPrompt = (await telegram_db.getChatAISettings(ctx, AI_ID, false, 'SUMMARY_PROMPT'))?.rows?.[0]?.value;
					if(summaryPrompt){
						// Уведомляем, что получили запрос и начали готовить ответ
						const _waitMessage = await showWaitMessage(ctx);

						// Запрашиваем ответ у DeepSeek
						const answer = await sendMessages2AI(
							ctx,
							AI_ID,
							[{
								role:    'user',
								content: `Проанализируй этот JSON-массив сообщений:\n\n${JSON.stringify(messages, null, 2)}\n\n${add_query ? `Ответь на запрос ${add_query}` : ''}`
							}],
							chat?.id,
							true,
							IS_SUMMARY_MESSAGE,
							summaryPrompt);

						// Останавливаем обновление сообщения
						await hideWaitMessage(_waitMessage);

						// Отправляем ответ
						return sendAnswerIA(ctx, answer);
					}

				}else{
					logger.warn('Нет сообщений на отправку в DeepSeek').then();
				}

			}else{
				return sendHelpMessageIA(ctx);
			}
		}
	}
};

