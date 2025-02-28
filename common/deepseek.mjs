import OpenAI from "openai";
import logger from "./logger.mjs";

const openai = new OpenAI({
	baseURL: 'https://api.deepseek.com',
	apiKey:  process.env.DEEPSEEK_API_KEY,
});

export async function isSpamMessage(message){
	try{
		const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
		
		logger.log(`Тест сообщения на спам "${message}"`).then();
		
		const completion = await openai.chat.completions.create({
			messages: [{role: 'user', content: prompt}],
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
		const prompt = `Check the message in quotes and answer only YES or NO if the message looks like SPAM "${message}"`;
		
		logger.log(`Тест сообщения на спам "${message}"`).then();
		const completion = await openai.chat.completions.create({
			messages: [{role: 'user', content: prompt}],
			model:    'deepseek-chat',
			temperature: 1.3,
		});
		
		return completion.choices[0].message.content;
		
	}catch(err){
		logger.err(err).then();
		
		return '';
	}
}

export async function sendQuestion(message){
	try{
		const prompt = `${message}`;
		
		logger.log(`Отправка сообщения "${message}"`).then();
		const completion = await openai.chat.completions.create({
			messages: [{role: 'user', content: prompt}],
			model:    'deepseek-chat',
			temperature: 1.5,
		});
		
		return completion.choices[0].message.content;
		
	}catch(err){
		logger.err(err).then();
		
		return '';
	}
}
