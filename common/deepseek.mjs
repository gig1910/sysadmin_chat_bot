import OpenAI                          from "openai";
import logger                          from "./logger.mjs";
import * as telegram                   from "./telegram.mjs";
import * as telegram_db                from "./telegram_db.mjs";
import {query}                         from "./db.mjs";
import {getMessagesFromChatByInterval} from "./telegram_db.mjs";
import context                         from "telegraf/src/context";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

let openai;
if(DEEPSEEK_API_KEY){
	openai = new OpenAI({
		baseURL: 'https://api.deepseek.com',
		apiKey:  process.env.DEEPSEEK_API_KEY,
		timeout: 10 * 60 * 1000, // 10 минут
	});
}

const IS_SPAM           = 1;
const IS_MESSAGE        = 2;
const IS_TEST_MESSAGE   = 3;
const AI_MODEL_REASONER = 1;
const AI_MODEL_CHAT     = 2;

const AI_CHAT_MODEL     = 'deepseek-v4-flash';
const AI_REASONER_MODEL = 'deepseek-v4-pro';

/**
 * Тест сообщения на SPAM
 * @param {String} message
 * @returns {Promise<Boolean>}
 */
export async function isSpamMessage(message){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return false;
	}

	// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
	logger.log(`Тест сообщения на спам "${message}"`).then();
	const _messages = [{
		role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
	}, {
		role: 'user', content: message
	}];
	const _id       = (await query(`WITH INS (ID) AS (
                                    INSERT
                                    INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL)
                                    VALUES ($1::JSONB, $2:: SMALLINT, $3:: SMALLINT) RETURNING ID)
            SELECT ID
            FROM INS;`,
		[JSON.stringify(_messages, null, ''), IS_SPAM, AI_MODEL_REASONER]
	))?.rows?.[0]?.id;
	logger.log(`Тест сообщения на спам (${_id}) "${message}"`).then();

	try{
		const completion = await openai.chat.completions.create({
			messages: _messages,
			model:    AI_CHAT_MODEL, //AI_REASONER_MODEL,
		});

		const _answer = completion.choices[0].message;
		await query(`UPDATE AI_REQUEST
                     SET ANSWER = $1::JSONB,
                         ANSWER_TIMESTAMP = NOW()
                     WHERE ID = $2:: INT;`,
			[JSON.stringify(completion, null, ''), _id]
		);
		logger.log(_answer).then();

		return _answer?.content?.toUpperCase().includes('YES');

	}catch(err){
		logger.err(err).then();
		if(_id){
			await query(`UPDATE AI_REQUEST
                         SET ERROR = $1::JSONB,
                                 ERROR_TIMESTAMP = NOW()
                         WHERE ID = $2:: INT;`, [JSON.stringify(err, null, ''), _id]
			);
		}

		return false;
	}
}

/**
 *
 * @param {String} message
 * @returns {Promise<?String>}
 */
export async function testMessage(message){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;

	const _messages = [{
		role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
	}, {
		role: 'user', content: message
	}];
	const _id       = (await query(`WITH INS (ID) AS (
                                    INSERT
                                    INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL)
                                    VALUES ($1::JSONB, $2:: SMALLINT, $3:: SMALLINT) RETURNING ID)
                    SELECT ID
                    FROM INS;`,
			[JSON.stringify(_messages, null, ''), IS_TEST_MESSAGE, AI_MODEL_REASONER])
	)?.rows?.[0]?.id;
	logger.log(`Тест сообщения на спам (${_id}) "${message}"`).then();

	try{
		const completion = await openai.chat.completions.create({
			messages: _messages,
			model:    AI_CHAT_MODEL, //AI_REASONER_MODEL,
		});

		const _answer = completion.choices[0].message;
		await query(`UPDATE AI_REQUEST
                     SET ANSWER = $1::JSONB,
                         ANSWER_TIMESTAMP = NOW()
                     WHERE ID = $2:: INT;`,
			[JSON.stringify(completion, null, ''), _id]
		);
		logger.log(_answer).then();

		return _answer?.content;

	}catch(err){
		logger.err(err).then();
		if(_id){
			await query(`UPDATE AI_REQUEST
                         SET ERROR = $1::JSONB,
                                 ERROR_TIMESTAMP = NOW()
                         WHERE ID = $2:: INT;`, [JSON.stringify(err, null, ''), _id]
			);
		}

		return '';
	}
}

/**
 * Отправка сообщения в DeepSeek
 * @param {Object} messages
 * @param {Boolean} [analyse]
 * @param {Number} [chat_id]
 * @param {String} [systemPrompt]
 * @returns {Promise<Object>}
 */
export async function sendMessages(messages, analyse, chat_id, systemPrompt){
	if(!openai){
		logger.warn('DeepSeek API key is not set').then();
		return null;
	}

	if(messages?.length > 0){
		const _id = (await query(`WITH INS (ID) AS (
                                  INSERT
                                  INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL)
                                  VALUES ($1::JSONB, $2:: SMALLINT, $3:: SMALLINT) RETURNING ID)
                        SELECT ID
                        FROM INS;`,
				[JSON.stringify(messages, null, ''), IS_MESSAGE, AI_MODEL_CHAT])
		)?.rows?.[0]?.id;
		logger.log(`Отправка сообщений:"`).then();
		logger.log(`ID: ${_id}`).then();

		// Получаем блок настроек для чата/AI
		let temperature = 1;
		if(!systemPrompt){
			(await query(`SELECT TYPE, VALUE
                          FROM AI2CHAT_SETTINGS
                          WHERE CHAT_ID = $1::BIGINT AND AI_ID=$2:: INT
                            AND REASONER_MODE=$3::BOOL`,
				[chat_id, 1, !!analyse ? 't' : 'f']))?.rows?.map(row => {
				switch(row.type){
					case 'SYSTEM_PROMPT':
						systemPrompt = row.value;
						break;

					case 'TEMPERATURES':
						temperature = parseFloat(row.value);
						break;
				}
			});
		}

		if(systemPrompt){
			messages = [{role: 'system', content: systemPrompt}].concat(messages);
		}

		try{
			let aiParams = {};
			if(!!analyse){

				/* {
					role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
				} */
				aiParams = {
					messages,
					model:            AI_CHAT_MODEL,
					thinking:         {"type": "enabled"},
					reasoning_effort: "high",
					temperature:      temperature || 1,
				};

			}else{
				aiParams = {
					messages,
					model:       AI_CHAT_MODEL,
					temperature: temperature || 0.85,
				};
			}

			logger.trace(aiParams).then();

			const completion = await openai.chat.completions.create(aiParams);
			const _answer    = completion.choices[0].message;
			await query(`UPDATE AI_REQUEST
                         SET ANSWER = $1::JSONB,
                             ANSWER_TIMESTAMP = NOW()
                         WHERE ID = $2:: INT;`, [JSON.stringify(completion, null, ''), _id]
			);

			logger.trace(`Ответ:`).then();
			logger.dir(_answer).then();

			return _answer;

		}catch(err){
			logger.err(err).then();
			if(_id){
				await query(`UPDATE AI_REQUEST
                             SET ERROR = $1::JSONB,
                                 ERROR_TIMESTAMP = NOW()
                             WHERE ID = $2:: INT;`, [JSON.stringify(err, null, ''), _id]
				);
			}

			return null;
		}
	}
}

// ------------------------------------------------

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @param {Boolean} [analyse]
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekTalks = async(ctx, analyse) => {
	if(!openai){
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

				// Сохраняем сообщение (Тут надо дождаться, чтобы из БД получить сразу весь диалог, включая ЭТО сообщение)
				await telegram_db.addMessage2DB(ctx, chat, user, message).catch(console.error);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesReplyLink(ctx?.botInfo?.id, message.chat?.id, message.message_id);

				if(messages?.length > 0){
					// Запрашиваем ответ у DeepSeek

					// Уведомляем, что получили запрос и начали готовить ответ
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
					}, 4000);

					const answer = await sendMessages(messages, analyse, chat.id);

					// Останавливаем обновление сообщения
					clearInterval(updater_handler);

					// Удаляем уведомление о подготовке ответа
					for(let i = 0; i < _mess?.length; i++){
						const mess_id = (await _mess[i])?.message_id;
						telegram.deleteMessage(ctx, mess_id).then();
					}

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

/**
 * Диалог с DeepSeek
 * @param {CTX} ctx
 * @param {Boolean} [analyse]
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekSummary = async(ctx, analyse) => {
	if(!openai){
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

			const text = message.text.replace(/^\/summary(?:@\w+)?\s*/igm, '').trim();
			if(text){
				const re   = /(\d)(h|m|d)/igm;
				const arr  = re.exec(text);
				let amount = 2;
				let period = 'h';
				if(arr?.length){
					amount = parseInt(arr[1], 10);
					period = arr[2].toLowerCase();
				}

				let interval = '';
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


				// Сохраняем сообщение (Тут надо дождаться, чтобы из БД получить сразу весь диалог, включая ЭТО сообщение)
				await telegram_db.addMessage2DB(ctx, chat, user, message).catch(console.error);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesFromChatByInterval(message.chat?.id, ctx?.botInfo?.id, interval);

				if(messages?.length > 0){
					// Запрашиваем ответ у DeepSeek

					// Уведомляем, что получили запрос и начали готовить ответ
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
					}, 4000);

					let answer = {};

					try{
						let aiParams = {
							    messages:    [
								    {
									    role:    'system',
									    content: 'Ты — аналитический ассистент. Твоя задача — изучить переданный массив сообщений и составить каткое, емкое текстовое резюме (summary) диалога, структурированное по ролям.\n' +
									             'Используй Markdown для оформления. Твой ответ должен состоять только из блоков по каждому участнику.\n' +
									             'Правила анализа и оформления:\n' +
									             '1. Выдели каждого уникального участника по полю "name" (или "role", если "name" отсутствует).\n' +
									             '2. Для каждого участника создай заголовок: `### Участник: [Имя/Роль]`\n' +
									             '3. Ниже заголовка списком перечисли ключевую суть его сообщений: тезисы, запросы, предложения, обязательства или принятые решения.\n' +
									             '4. Полностью игнорируй флуд, приветствия, вежливость и неважные детали. Только сухие факты.\n' +
									             '5. Если участник просто поддакивал или не нес смысловой нагрузки, не добавляй его в финальный текст.\n' +
									             '6. В самом конце добавь блок `### Итог диалога:` с главным результатом беседы в 1–2 предложениях.\n' +
									             'Пиши строго по делу, без вводных фраз в начале ответа.'
								    },
								    {
									    role: 'user',
									    content:
									          `Проанализируй этот JSON-массив сообщений:\n\n${JSON.stringify(messages, null, 2)}`
								    }],
							    model:       AI_CHAT_MODEL,
							    temperature: 0.2,
						    };

						logger.trace(aiParams).then();

						const completion = await openai.chat.completions.create(aiParams);
						const _answer    = completion.choices[0].message;
						await query(`UPDATE AI_REQUEST
                                     SET ANSWER = $1::JSONB,
                             ANSWER_TIMESTAMP = NOW()
                                     WHERE ID = $2:: INT;`, [JSON.stringify(completion, null, ''), _id]
						);

						logger.trace(`Ответ:`).then();
						logger.dir(_answer).then();

						return _answer;

					}catch(err){
						logger.err(err).then();
						if(_id){
							await query(`UPDATE AI_REQUEST
                                         SET ERROR = $1::JSONB,
                                 ERROR_TIMESTAMP = NOW()
                                         WHERE ID = $2:: INT;`, [JSON.stringify(err, null, ''), _id]
							);
						}

						return null;
					}

					// Останавливаем обновление сообщения
					clearInterval(updater_handler);

					// Удаляем уведомление о подготовке ответа
					for(let i = 0; i < _mess?.length; i++){
						const mess_id = (await _mess[i])?.message_id;
						telegram.deleteMessage(ctx, mess_id).then();
					}

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

