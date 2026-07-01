import fetch  from 'node-fetch';
import logger from './logger.mjs';

const DEFAULT_TIME_ZONE = process.env.BOT_TIME_ZONE || 'Europe/Belgrade';
const AI_ALLOW_INTERNET = process.env.AI_ALLOW_INTERNET === 'true';

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const SEARXNG_URL = process.env.SEARXNG_URL;
const SEARXNG_API_KEY = process.env.SEARXNG_API_KEY;
const GITHUB_SEARCH_TOKEN = process.env.GITHUB_SEARCH_TOKEN;

const SEARCH_TIMEOUT_MS = Number.parseInt(process.env.AI_SEARCH_TIMEOUT_MS || '15000', 10);
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.AI_FETCH_TIMEOUT_MS || '20000', 10);
const MAX_SEARCH_RESULTS = Number.parseInt(process.env.AI_SEARCH_MAX_RESULTS || '8', 10);
const MAX_FETCH_CHARS = Number.parseInt(process.env.AI_FETCH_MAX_CHARS || '30000', 10);

export const AI_TOOLS_SYSTEM_PROMPT = `
Доступны внешние инструменты.
- Для вопросов с относительными датами и временем используй get_current_datetime.
- Для чтения конкретной ссылки используй internet_fetch_url.
- Для вопросов по StackOverflow, ServerFault, SuperUser и Unix/Linux используй stackexchange_search.
- Для справочных энциклопедических фактов используй wikipedia_search.
- Для поиска по GitHub используй github_search.
- Если среди доступных tools есть internet_search, используй его для свежей информации, версий ПО, документации, цен, новостей, расписаний, статусов сервисов и фактов, которые могли измениться.
- Если инструмент вернул источники, в ответе указывай URL источников.
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
		description: 'Search the public internet through the configured search provider. The model does not choose the provider; the bot chooses it from AI_SEARCH_PROVIDERS or AI_SEARCH_PROVIDER.',
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

const internetFetchUrlTool = {
	type: 'function',
	function: {
		name: 'internet_fetch_url',
		description: 'Fetch readable text from a public HTTP/HTTPS URL provided by the user. Use it when the user gives a specific link.',
		parameters: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'Public HTTP or HTTPS URL.'
				}
			},
			required: ['url'],
			additionalProperties: false
		}
	}
};

const stackExchangeSearchTool = {
	type: 'function',
	function: {
		name: 'stackexchange_search',
		description: 'Search StackExchange network sites such as StackOverflow, ServerFault, SuperUser, AskUbuntu and Unix/Linux.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query.'
				},
				site: {
					type: 'string',
					description: 'StackExchange site key.',
					enum: ['stackoverflow', 'serverfault', 'superuser', 'askubuntu', 'unix']
				},
				count: {
					type: 'integer',
					minimum: 1,
					maximum: 10
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

const wikipediaSearchTool = {
	type: 'function',
	function: {
		name: 'wikipedia_search',
		description: 'Search Wikipedia through MediaWiki API. Use for encyclopedia-style facts, terms, people, projects and technologies.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query.'
				},
				lang: {
					type: 'string',
					description: 'Wikipedia language code, for example ru, en, de.'
				},
				count: {
					type: 'integer',
					minimum: 1,
					maximum: 10
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

const githubSearchTool = {
	type: 'function',
	function: {
		name: 'github_search',
		description: 'Search GitHub repositories, issues or code through GitHub REST Search API.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'GitHub search query. GitHub search operators are allowed.'
				},
				type: {
					type: 'string',
					description: 'GitHub search type.',
					enum: ['repositories', 'issues', 'code']
				},
				count: {
					type: 'integer',
					minimum: 1,
					maximum: 10
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

function normalizeSearchCount(count){
	const parsed = Number.parseInt(count ?? '5', 10);
	if(!Number.isFinite(parsed)){
		return 5;
	}

	return Math.min(Math.max(parsed, 1), Math.min(MAX_SEARCH_RESULTS, 10));
}

function getConfiguredSearchProviderNames(){
	return String(process.env.AI_SEARCH_PROVIDERS || process.env.AI_SEARCH_PROVIDER || 'searxng')
		.split(',')
		.map(provider => provider.trim().toLowerCase())
		.filter(Boolean);
}

function getSearchProviderConfig(providerName){
	switch(providerName){
		case 'searxng':
			return {
				name: 'searxng',
				configured: !!SEARXNG_URL,
				search: searxngSearch
			};

		case 'brave':
			return {
				name: 'brave',
				configured: !!BRAVE_SEARCH_API_KEY,
				search: braveSearch
			};

		default:
			return {
				name: providerName,
				configured: false,
				search: null
			};
	}
}

function getConfiguredSearchProviders(){
	return getConfiguredSearchProviderNames()
		.map(getSearchProviderConfig)
		.filter(provider => provider.configured && typeof provider.search === 'function');
}

function isInternetSearchConfigured(){
	return AI_ALLOW_INTERNET && getConfiguredSearchProviders().length > 0;
}

export function getAIToolDefinitions(){
	const tools = [currentDateTimeTool];

	if(AI_ALLOW_INTERNET){
		tools.push(internetFetchUrlTool, stackExchangeSearchTool, wikipediaSearchTool, githubSearchTool);
	}

	if(isInternetSearchConfigured()){
		tools.push(internetSearchTool);
	}

	return tools;
}

function assertInternetAllowed(){
	if(!AI_ALLOW_INTERNET){
		throw new Error('Internet tools are disabled. Set AI_ALLOW_INTERNET=true to enable them.');
	}
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

async function fetchJson(url, {timeoutMs = SEARCH_TIMEOUT_MS, headers = {}} = {}){
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try{
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'application/json',
				...headers
			},
			signal: controller.signal
		});

		if(!response.ok){
			throw new Error(`HTTP ${response.status}`);
		}

		return response.json();

	}finally{
		clearTimeout(timer);
	}
}

function stripHtml(value){
	return String(value || '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gim, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, ' ')
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gim, ' ')
		.replace(/<[^>]+>/gim, ' ')
		.replace(/&nbsp;/gim, ' ')
		.replace(/&amp;/gim, '&')
		.replace(/&lt;/gim, '<')
		.replace(/&gt;/gim, '>')
		.replace(/&quot;/gim, '"')
		.replace(/&#39;/gim, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function buildSearchResult({title, url, description, source, provider, published_at, score, extra}){
	return {
		title:       String(title || '').trim(),
		url:         String(url || '').trim(),
		description: stripHtml(description),
		source:      source || provider || null,
		provider:    provider || null,
		published_at: published_at || null,
		score:       Number.isFinite(score) ? score : null,
		extra:       extra || null
	};
}

async function braveSearch(args){
	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const count = normalizeSearchCount(args?.count);
	const language = String(args?.language || '').trim().toLowerCase();

	const url = new URL('https://api.search.brave.com/res/v1/web/search');
	url.searchParams.set('q', query);
	url.searchParams.set('count', String(count));
	url.searchParams.set('text_decorations', 'false');

	if(language){
		url.searchParams.set('search_lang', language);
	}

	const data = await fetchJson(url, {
		headers: {'X-Subscription-Token': BRAVE_SEARCH_API_KEY}
	});

	const results = (data?.web?.results ?? [])
		.slice(0, count)
		.map(item => buildSearchResult({
			title:       item?.title,
			url:         item?.url,
			description: item?.description,
			source:      item?.profile?.name,
			provider:    'brave',
			published_at: item?.age || null,
			extra: {
				language: item?.language ?? null
			}
		}));

	return {
		provider: 'brave',
		query,
		count: results.length,
		results
	};
}

async function searxngSearch(args){
	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const count = normalizeSearchCount(args?.count);
	const language = String(args?.language || '').trim().toLowerCase();

	const url = new URL('/search', SEARXNG_URL);
	url.searchParams.set('q', query);
	url.searchParams.set('format', 'json');

	if(language){
		url.searchParams.set('language', language);
	}

	const headers = {};
	if(SEARXNG_API_KEY){
		headers['Authorization'] = `Bearer ${SEARXNG_API_KEY}`;
	}

	const data = await fetchJson(url, {headers});
	const results = (data?.results ?? [])
		.slice(0, count)
		.map(item => buildSearchResult({
			title:       item?.title,
			url:         item?.url,
			description: item?.content,
			source:      item?.engine,
			provider:    'searxng',
			published_at: item?.publishedDate || null,
			score:       Number(item?.score),
			extra: {
				category: item?.category ?? null
			}
		}));

	return {
		provider: 'searxng',
		query,
		count: results.length,
		results
	};
}

async function internetSearch(args){
	assertInternetAllowed();

	const providers = getConfiguredSearchProviders();
	if(!providers.length){
		throw new Error('No configured internet search provider. Set AI_SEARCH_PROVIDER=searxng and SEARXNG_URL, or AI_SEARCH_PROVIDER=brave and BRAVE_SEARCH_API_KEY.');
	}

	const errors = [];

	for(const provider of providers){
		try{
			const result = await provider.search(args);
			if(result?.results?.length > 0){
				return result;
			}

			errors.push(`${provider.name}: empty result`);

		}catch(err){
			await logger.err(err);
			errors.push(`${provider.name}: ${err?.message ?? err}`);
		}
	}

	throw new Error(`All internet search providers failed: ${errors.join('; ')}`);
}

function isPrivateIPv4(host){
	const parts = host.split('.').map(Number);
	if(parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)){
		return false;
	}

	const [a, b] = parts;
	return a === 10 ||
	       a === 127 ||
	       a === 0 ||
	       (a === 172 && b >= 16 && b <= 31) ||
	       (a === 192 && b === 168) ||
	       (a === 169 && b === 254);
}

function validatePublicHttpUrl(value){
	const url = new URL(String(value || '').trim());
	const hostname = url.hostname.toLowerCase();

	if(!['http:', 'https:'].includes(url.protocol)){
		throw new Error('Only http/https URLs are allowed.');
	}

	if(hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1' || isPrivateIPv4(hostname)){
		throw new Error('Private/local URLs are not allowed.');
	}

	return url;
}

async function internetFetchUrl(args){
	assertInternetAllowed();

	const url = validatePublicHttpUrl(args?.url);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try{
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'text/html,text/plain,application/xhtml+xml,application/json',
				'User-Agent': 'sysadmin-chat-bot/0.3'
			},
			signal: controller.signal
		});

		if(!response.ok){
			throw new Error(`Fetch error: HTTP ${response.status}`);
		}

		const contentType = response.headers.get('content-type') ?? '';
		if(!/text\/html|text\/plain|application\/xhtml\+xml|application\/json/i.test(contentType)){
			throw new Error(`Unsupported content-type: ${contentType}`);
		}

		const raw = await response.text();
		const text = stripHtml(raw).slice(0, MAX_FETCH_CHARS);

		return {
			url: String(url),
			content_type: contentType,
			text,
			truncated: raw.length > MAX_FETCH_CHARS
		};

	}finally{
		clearTimeout(timer);
	}
}

async function stackExchangeSearch(args){
	assertInternetAllowed();

	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const site = String(args?.site || 'stackoverflow').trim().toLowerCase();
	const count = normalizeSearchCount(args?.count);
	const allowedSites = new Set(['stackoverflow', 'serverfault', 'superuser', 'askubuntu', 'unix']);
	if(!allowedSites.has(site)){
		throw new Error(`Unsupported StackExchange site: ${site}`);
	}

	const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
	url.searchParams.set('order', 'desc');
	url.searchParams.set('sort', 'relevance');
	url.searchParams.set('q', query);
	url.searchParams.set('site', site);
	url.searchParams.set('pagesize', String(count));
	url.searchParams.set('filter', 'default');

	const data = await fetchJson(url);
	const results = (data?.items ?? [])
		.slice(0, count)
		.map(item => buildSearchResult({
			title:       item?.title,
			url:         item?.link,
			description: item?.is_answered ? 'Question has an accepted or upvoted answer.' : 'Question has no accepted answer.',
			source:      site,
			provider:    'stackexchange',
			published_at: item?.creation_date ? new Date(item.creation_date * 1000).toISOString() : null,
			score:       Number(item?.score),
			extra: {
				answer_count: item?.answer_count ?? null,
				is_answered:  item?.is_answered ?? null,
				tags:         item?.tags ?? []
			}
		}));

	return {
		provider: 'stackexchange',
		site,
		query,
		count: results.length,
		results
	};
}

async function wikipediaSearch(args){
	assertInternetAllowed();

	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const lang = String(args?.lang || 'ru').trim().toLowerCase().replace(/[^a-z-]/g, '') || 'ru';
	const count = normalizeSearchCount(args?.count);

	const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
	url.searchParams.set('action', 'query');
	url.searchParams.set('list', 'search');
	url.searchParams.set('srsearch', query);
	url.searchParams.set('format', 'json');
	url.searchParams.set('utf8', '1');
	url.searchParams.set('srlimit', String(count));
	url.searchParams.set('origin', '*');

	const data = await fetchJson(url);
	const results = (data?.query?.search ?? [])
		.slice(0, count)
		.map(item => {
			const title = String(item?.title || '');
			return buildSearchResult({
				title,
				url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
				description: item?.snippet,
				source: `${lang}.wikipedia.org`,
				provider: 'wikipedia',
				published_at: item?.timestamp || null,
				extra: {
					pageid: item?.pageid ?? null,
					wordcount: item?.wordcount ?? null
				}
			});
		});

	return {
		provider: 'wikipedia',
		lang,
		query,
		count: results.length,
		results
	};
}

async function githubSearch(args){
	assertInternetAllowed();

	const query = String(args?.query || '').trim();
	if(!query){
		throw new Error('Search query is empty.');
	}

	const type = String(args?.type || 'repositories').trim().toLowerCase();
	const count = normalizeSearchCount(args?.count);
	const endpoints = {
		repositories: 'repositories',
		issues:       'issues',
		code:         'code'
	};

	if(!endpoints[type]){
		throw new Error(`Unsupported GitHub search type: ${type}`);
	}

	const url = new URL(`https://api.github.com/search/${endpoints[type]}`);
	url.searchParams.set('q', query);
	url.searchParams.set('per_page', String(count));

	const headers = {
		'Accept': 'application/vnd.github+json',
		'User-Agent': 'sysadmin-chat-bot/0.3'
	};

	if(GITHUB_SEARCH_TOKEN){
		headers['Authorization'] = `Bearer ${GITHUB_SEARCH_TOKEN}`;
	}

	const data = await fetchJson(url, {headers});
	const results = (data?.items ?? [])
		.slice(0, count)
		.map(item => buildSearchResult({
			title:       item?.full_name || item?.title || item?.name || item?.path,
			url:         item?.html_url,
			description: item?.description || item?.body || item?.repository?.description,
			source:      'github.com',
			provider:    'github',
			published_at: item?.updated_at || item?.created_at || null,
			score:       Number(item?.score),
			extra: {
				type,
				state: item?.state ?? null,
				language: item?.language ?? null,
				stars: item?.stargazers_count ?? null,
				repository: item?.repository?.full_name ?? item?.full_name ?? null
			}
		}));

	return {
		provider: 'github',
		type,
		query,
		count: results.length,
		results
	};
}

export async function callAITool(name, rawArgs){
	const args = parseToolArguments(rawArgs);

	switch(name){
		case 'get_current_datetime':
			return getCurrentDateTime(args);

		case 'internet_search':
			return internetSearch(args);

		case 'internet_fetch_url':
			return internetFetchUrl(args);

		case 'stackexchange_search':
			return stackExchangeSearch(args);

		case 'wikipedia_search':
			return wikipediaSearch(args);

		case 'github_search':
			return githubSearch(args);

		default:
			throw new Error(`Unknown AI tool: ${name}`);
	}
}
