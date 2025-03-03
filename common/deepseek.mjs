import OpenAI from "openai";
import logger from "./logger.mjs";
import * as telegram from "./telegram.mjs";
import * as telegram_db from "./telegram_db.mjs";

const openai = new OpenAI({
	baseURL: 'https://api.deepseek.com',
	apiKey:  process.env.DEEPSEEK_API_KEY,
	timeout: 10 * 60 * 1000, // 10 минут
});

export async function isSpamMessage(message){
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

export async function testMessage(message){
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

export async function sendMessages(messages){
	if(messages?.length > 0){
		try{
			logger.log(`Отправка сообщений:"`).then();
			logger.dir(messages).then();
			const completion = await openai.chat.completions.create({
				messages:    [{role: 'system', content: 'Отвечай на русском языке используя разметку `markdown` поддерживаемую мессенджером `telegram`. По-возможности ответ не должен быть более 4000 символов.'}].concat(messages),
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
 * @returns {Promise<Message.TextMessage>}
 */
export const deepSeekTalks = async(ctx) => {
	const message = ctx?.update?.message || ctx?.update?.edited_message;
	if(message && message?.message_id && message?.text){
		const botInfo = ctx?.botInfo;
		if(botInfo && botInfo?.is_bot && botInfo?.id){
			const chat = message.chat;
			const user = message.from;
			
			// Сохраняем сообщение (Тут надо дождаться что бы из БД получить сразу весь диалог, включая ЭТО сообщение)
			await telegram_db.addMessage2DB(ctx, chat, user, message);
			
			// Получаем историю сообщений
			const messages = await telegram_db.getMessagesReplyLink(ctx?.botInfo?.id, message.message_id);
			
			if(messages?.length > 0){
				// Запрашиваем ответ у DeepSeek
				const answer = await sendMessages(messages);
				if(answer){
					// Отправляем ответ DeepSeek как ответ на сообщение
					let mess = await telegram.replyMessage(ctx, message?.message_id, answer?.content, true);
					Promise.all(mess).then(mess => {
						mess?.forEach(m => {
							if(m?.length > 0){
								Promise.all(m).then(m => {
									m.forEach(m => {
										if(m?.message_id){
											ctx.update.message = m;
											//Сохраняем ответ DeepSeek в БД для получения полноценного диалога, но только если смогли отправить ответ в телеграм
											telegram_db.addMessage2DB(ctx, chat, botInfo, m).then();
										}
									});
								});
							}
						});
					});
					
					return mess;
				}
			}
		}
	}
};

