import fetch  from 'node-fetch';
import logger from './logger.mjs';

const DEFAULT_TIME_ZONE = process.env.BOT_TIME_ZONE || 'Europe/Belgrade';
const AI_ALLOW_INTERNET = process.env.AI_ALLOW_INTERNET === 'true';
const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

const SEARCH_TIMEOUT_MS = Number.parseInt(process.env.AI_SEARCH_TIMEOUT_MS || '15000', 10);
const MAX_SEARCH_RESULTS = Number.parseInt(process.env.AI_SEARCH_MAX_RESULTS || '8', 10);

export const AI_TOOLS_SYSTEM_PROMPT = `
Доступны внешние инструменты.
- Для вопросов с относительными датами и временем используй get_current_datetime.
- Если среди доступных tools есть internet_search, используй его для свежей информации, версий ПО, документации, цен, новостей, расписаний, статусов сервисов и фактов, которые могли измениться.
- Если internet_search вернул источники, в ответе указывай URL источников.
- Если инструмент вернул ошибку или данных недостаточно, прямо скажи об этом и не выдумывай недостающие факты.
`.trim();

const currentDateTimeTool = {
	type: 'function',
	function: {
		name: 'get_current_datetime',
		description: 'Return the current date and time in UTC and in a requested IANA time zone. Use it for relative dates like today, tomorrow, yesterday, now, this week, current year.',
		parameters: {
			type: 'object',
			properties: {
				time_zone: {
					type: 'string',
					description: 'IANA time zone name, for example Europe/Belgrade. If omitted, the bot default time zone is used.'
				},
				locale: {
					type: 'string',
					description: 'BCP 47 locale for human readable date formatting, for example ru-RU or en-US.'
				}
			},
			additionalProperties: false
		}
	}
};

const internetSearchTool = {
	type: 'function',
	function: {
		name: 'internet_search',
		description: 'Search the public internet through Brave Search API and return web result titles, URLs and snippets. Use only when current or external information is needed.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query.'
				},
				count: {
					type: 'integer',
					description: 'Number of results to return, from 1 to 10.',
					minimum: 1,
					maximum: 10
				},
				language: {
					type: 'string',
					description: 'Optional search language code, for example ru, en, de.'
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

function isInternetSearchConfigured(){
	return AI_ALLOW_INTERNET && !!BRAVE_SEARCH_API_KEY;
}

export function getAIToolDefinitions(){
	const tools = [currentDateTimeTool];

	if(isInternetSearchConfigured()){
		tools.push(internetSearchTool);
	}

	return tools;
}

function parseToolArguments(rawArgs){
	if(!rawArgs){
		return {};
	}

	if(typeof rawArgs === 'object'){
		return rawArgs;
	}

	if(typeof rawArgs !== 'string'){
		throw new Error('Tool arguments must be JSON string or object');
	}

	try{
		return JSON.parse(rawArgs || '{}');
	}catch(err){
		throw new Error(`Invalid tool arguments JSON: ${err?.message ?? err}`);
	}
}

function getDateTimeParts(date, timeZone, locale){
	const formatter = new Intl.DateTimeFormat(locale, {
		timeZone,
		year:   'numeric',
		month:  '2-digit',
		day:    '2-digit',
		hour:   '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		weekday: 'long'
	});

	return formatter.formatToParts(date).reduce((acc, part) => {
		if(part.type !== 'literal'){
			acc[part.type] = part.value;
		}
		return acc;
	}, {});
}

function getCurrentDateTime(args){
	const now = new Date();
	const locale = String(args?.locale || 'ru-RU').trim() || 'ru-RU';
	let timeZone = String(args?.time_zone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
	let parts;

	try{
		parts = getDateTimeParts(now, timeZone, locale);
	}catch(err){
		timeZone = 'UTC';
		parts = getDateTimeParts(now, timeZone, locale);
	}

	const localDate = `${parts.year}-${parts.month}-${parts.day}`;
	const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;

	return {
		unix_ms:      now.getTime(),
		unix_seconds: Math.floor(now.getTime() / 1000),
		utc_iso:      now.toISOString(),
		time_zone:    timeZone,
		local_date:   localDate,
		local_time:   localTime,
		local_iso:    `${localDate}T${localTime}`,
		weekday:      parts.weekday,
		locale
	};
}

function normalizeSearchCount(count){
	const parsed = Number.parseInt(count ?? '5', 10);
	if(!Number.isFinite(parsed)){
		return 5;
	}

	return Math.min(Math.max(parsed, 1), Math.min(MAX_SEARCH_RESULTS, 10));
}

async function internetSearch(args){
	if(!AI_ALLOW_INTERNET){
		throw new Error('Internet search is disabled. Set AI_ALLOW_INTERNET=true to enable it.');
	}

	if(!BRAVE_SEARCH_API_KEY){
		throw new Error('BRAVE_SEARCH_API_KEY is not set.');
	}

	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const count = normalizeSearchCount(args?.count);
	const language = String(args?.language || '').trim().toLowerCase();

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

	try{
		const url = new URL('https://api.search.brave.com/res/v1/web/search');
		url.searchParams.set('q', query);
		url.searchParams.set('count', String(count));
		url.searchParams.set('text_decorations', 'false');

		if(language){
			url.searchParams.set('search_lang', language);
		}

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'application/json',
				'X-Subscription-Token': BRAVE_SEARCH_API_KEY
			},
			signal: controller.signal
		});

		if(!response.ok){
			throw new Error(`Brave Search API error: HTTP ${response.status}`);
		}

		const data = await response.json();
		const results = data?.web?.results ?? [];

		return {
			provider: 'brave',
			query,
			count: results.length,
			results: results.slice(0, count).map(item => ({
				title:       item?.title ?? '',
				url:         item?.url ?? '',
				description: item?.description ?? '',
				age:         item?.age ?? null,
				language:    item?.language ?? null
			}))
		};

	}catch(err){
		await logger.err(err);
		throw err;

	}finally{
		clearTimeout(timer);
	}
}

export async function callAITool(name, rawArgs){
	const args = parseToolArguments(rawArgs);

	switch(name){
		case 'get_current_datetime':
			return getCurrentDateTime(args);

		case 'internet_search':
			return internetSearch(args);

		default:
			throw new Error(`Unknown AI tool: ${name}`);
	}
}
