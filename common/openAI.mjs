import fetch from 'node-fetch';
import logger from "./logger.mjs";

export async function isSpamMessage(message){
	try{
		const prompt = `Test messages in quotes and say only YES if message simulate as SPAM "${message}"`;
		
		logger.log(`Тест сообщения на спам "${message}"`).then();
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method:  'POST',
			headers: {
				'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
				'Content-Type':  'application/json'
			},
			body:    JSON.stringify({
				'model':              'deepseek/deepseek-r1:free',
				'messages':           [
					{'role': 'user', 'content': prompt}
				],
				'top_p':              1,
				'temperature':        0.85,
				'repetition_penalty': 1
			})
		});
		
		if(response.ok){
			if(response.status === 200){
				try{
					const answer = await response.json();
					
					logger.log(`Ответ от AI "${answer?.choices && answer.choices[0]?.message?.content}"`).then();
					return (answer?.choices && answer.choices[0]?.message?.content?.toUpperCase().includes('YES'));
					
				}catch(err){
					logger.err(err).then();
				}
				
			}else{
				logger.warn(`response status: ${response.status}`).then();
			}
			
		}else{
			logger.warn(`response state: ${response.ok}`).then();
		}
		
		return false;
	}catch(err){
		logger.err(err);
		
		return false;
	}
}