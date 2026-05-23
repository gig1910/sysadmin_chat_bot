import OpenAI from "openai";
import logger from "./logger.mjs";
import * as telegram from "./telegram.mjs";
import * as telegram_db from "./telegram_db.mjs";
import {query} from "./db.mjs";

const AI_URL = process.env.AI_URL;
if(!AI_URL){
	logger.warn(`Not set AI URL. AI won't worked.`).then();
}

const AI_API_KEY = process.env.AI_URL;
if(!AI_API_KEY){
	logger.warn(`Not set AI URL. AI won't worked.`).then();
}

const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL;
const AI_REASON_MODEL = process.env.AI_REASON_MODEL;
const AI_HISTORY_MESSAGES_MAX_LENGTH = parseInt(process.env.AI_HISTORY_MESSAGES_MAX_LENGTH, 10) ?? 1000;

let openai;
if(AI_API_KEY){
	openai = new OpenAI({
		baseURL: AI_URL,
		apiKey: AI_API_KEY,
		timeout: 10 * 60 * 1000, // 10 минут
	});
}

const IS_SPAM = 1;
const IS_MESSAGE = 2;
const IS_TEST_MESSAGE = 3;
const AI_MODEL_REASONER = 1;
const AI_MODEL_CHAT = 2;

/**
 * Тест сообщения на SPAM
 * @param {String} message
 * @returns {Promise<Boolean>}
 */
export async function isSpamMessage(message){
	if(!openai){
		logger.warn('AI not configure').then();
		return null;
	}

	// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
	logger.log(`Тест сообщения на спам "${message}"`).then();
	const _messages = [{
		role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
	}, {
		role: 'user', content: message
	}];
	const _id = (await query(`
                WITH INS (ID) AS (INSERT INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL) VALUES ($1::JSONB, $2::SMALLINT, $3::SMALLINT) RETURNING ID)
                SELECT ID
                FROM INS;`,
		[JSON.stringify(_messages, null, ''), IS_SPAM, AI_MODEL_REASONER]
	))?.rows?.[0]?.id;
	logger.log(`Тест сообщения на спам (${_id}) "${message}"`).then();

	try{
		const completion = await openai.chat.completions.create({
			messages: _messages,
			model: 'deepseek-reasoner',
		});

		const _answer = completion.choices[0].message;
		await query(`
                    UPDATE AI_REQUEST
                    SET ANSWER           = $1::JSONB,
                        ANSWER_TIMESTAMP = NOW()
                    WHERE ID = $2::INT;`,
			[JSON.stringify(completion, null, ''), _id]
		);
		logger.log(_answer).then();

		return _answer?.content?.toUpperCase().includes('YES');

	}catch(err){
		logger.err(err).then();
		if(_id){
			await query(`UPDATE AI_REQUEST
                         SET ERROR           = $1::JSONB,
                             ERROR_TIMESTAMP = NOW()
                         WHERE ID = $2::INT;`, [JSON.stringify(err, null, ''), _id]
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
		logger.warn('AI not configure').then();
		return null;
	}

	// const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;

	const _messages = [{
		role: 'system', content: 'Check the message and answer only YES or NO if the message looks like SPAM'
	}, {
		role: 'user', content: message
	}];
	const _id = (await query(
			`WITH INS (ID) AS (INSERT INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL) VALUES ($1::JSONB, $2::SMALLINT, $3::SMALLINT) RETURNING ID)
             SELECT ID
             FROM INS;`,
			[JSON.stringify(_messages, null, ''), IS_TEST_MESSAGE, AI_MODEL_REASONER])
	)?.rows?.[0]?.id;
	logger.log(`Тест сообщения на спам (${_id}) "${message}"`).then();

	try{
		const completion = await openai.chat.completions.create({
			messages: _messages,
			model: 'deepseek-reasoner',
		});

		const _answer = completion.choices[0].message;
		await query(`
                    UPDATE AI_REQUEST
                    SET ANSWER           = $1::JSONB,
                        ANSWER_TIMESTAMP = NOW()
                    WHERE ID = $2::INT;`,
			[JSON.stringify(completion, null, ''), _id]
		);
		logger.log(_answer).then();

		return _answer?.content;

	}catch(err){
		logger.err(err).then();
		if(_id){
			await query(`UPDATE AI_REQUEST
                         SET ERROR           = $1::JSONB,
                             ERROR_TIMESTAMP = NOW()
                         WHERE ID = $2::INT;`, [JSON.stringify(err, null, ''), _id]
			);
		}

		return '';
	}
}

/**
 * Отправка сообщения в DeepSeek
 * @param {Object} messages
 * @returns {Promise<Object>}
 */
export async function sendMessages(messages){
	if(!openai){
		logger.warn('AI not configure').then();
		return null;
	}

	if(messages?.length > 0){
		const _id = (await query(`
                            WITH INS (ID) AS ( INSERT INTO AI_REQUEST (REQUEST, AI_KIND, AI_MODEL) VALUES ($1::JSONB, $2:: SMALLINT, $3:: SMALLINT) RETURNING ID)
                            SELECT ID
                            FROM INS;`,
				[JSON.stringify(messages, null, ''), IS_MESSAGE, AI_MODEL_CHAT])
		)?.rows?.[0]?.id;
		logger.log(`Отправка сообщений:"`).then();
		logger.log(`ID: ${_id}`).then();
		logger.dir(messages).then();

		try{
			const completion = await openai.chat.completions.create({
				messages,
				model: 'deepseek-chat',
				temperature: 1.5,
			});

			const _answer = completion.choices[0].message;
			await query(`UPDATE AI_REQUEST
                         SET ANSWER           = $1::JSONB,
                             ANSWER_TIMESTAMP = NOW()
                         WHERE ID = $2::INT;`, [JSON.stringify(completion, null, ''), _id]
			);

			logger.trace(`Ответ:`).then();
			logger.dir(_answer).then();

			return _answer;

		}catch(err){
			logger.err(err).then();
			if(_id){
				await query(`UPDATE AI_REQUEST
                             SET ERROR           = $1::JSONB,
                                 ERROR_TIMESTAMP = NOW()
                             WHERE ID = $2::INT;`, [JSON.stringify(err, null, ''), _id]
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
 * @returns {Promise<[Message.TextMessage]>}
 */
export const deepSeekTalks = async(ctx) => {
	if(!openai){
		logger.warn('AI not configure').then();
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
				await telegram_db.addMessage2DB(ctx, chat, user, message);

				// Получаем историю сообщений
				const messages = await telegram_db.getMessagesReplyLink(ctx?.botInfo?.id, message.chat?.id, message.message_id);

				if(messages?.length > 0){
					// Запрашиваем ответ у DeepSeek

					// Уведомляем, что получили запрос и начали готовить ответ
					let _symb = `🔃️`;
					const _mess = await telegram.replyMessage(ctx, message?.message_id, `${_symb} Минутку... Готовлю ответ...`, false);
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

					//  Предварительно Удаляем "лишние" символы с начала диалога и если превышен размер выставляем там ...
					const answer = await sendMessages(messages);

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

