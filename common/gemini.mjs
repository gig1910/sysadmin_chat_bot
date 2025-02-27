import * as logger from './logger.mjs';

import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"}, {
	/**
	/**
	* Version of API endpoint to call (e.g. "v1" or "v1beta"). If not specified,
	* defaults to latest stable version.
	 */
	apiVersion: 'v1',
	
	/**
	 * Base endpoint url. Defaults to "https://generativelanguage.googleapis.com"
	 */
    // baseUrl: 'https://us-central1-aiplatform.googleapis.com',
});

export async function isSpam(message){
	try{
		logger.info('Запускаем проверку на СПАМ...').then();
		const prompt = `Определи сообщение в кавычках на спам, ответь ДА или НЕТ "${message}"`;
		const result = await model.generateContent(prompt);
		const response = await result.response;
		const answer = response.text();
		logger.log(`ответ от Gemini для "${message}" - ${answer}`).then();
		
		return answer?.toUpperCase() === 'ДА\n';

	}catch(err){
		logger.err(err).then();
		
		return false; // Ну что поделать - не смогли определить. Не падать же всему приложению...
	}
}