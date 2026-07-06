import * as db          from '../db.mjs';
import * as logger      from '../logger.mjs';
import * as deepseek    from '../deepseek.mjs';
import * as memory_db   from '../memory_db.mjs';
import {isPlainObject, json2string, stripJsonFence} from '../utils.mjs';

const MEMORY_RECALC_QUERY_KIND = 5;
const MEMORY_RECALC_SYSTEM_PROMPT = `
You are an internal Telegram chat analysis job.
Analyze the provided chronological chat messages and extract low-sensitivity private context per human participant.

Return ONLY valid JSON with this shape:
{
  "users": [
    {
      "user_id": 123,
      "memory": [
        {"type":"preference|project_context|constraint|fact", "text":"short stable fact", "confidence":0.0}
      ],
      "characteristics_patch": {
        "communication_style": {},
        "technical_profile": {},
        "preferences": {},
        "constraints": {}
      },
      "observations": [
        {"evidence":"short non-sensitive evidence", "confidence":0.0}
      ]
    }
  ]
}

Rules:
- Extract data only for human participants from participants[].
- Do not create memory or characteristics for assistant/bot messages.
- Assistant messages are context only: use them to understand the conversation, but never attribute them to a human participant.
- Prefer stable repeated preferences, project context, technical stack, constraints, language/style preferences, and non-sensitive working context.
- Do not extract secrets, credentials, tokens, addresses, phone numbers, medical, religious, sexual, children-related or other sensitive data.
- Do not invent facts. If uncertain, omit.
- Keep every memory item short and directly useful for future answers in this chat.
- Keep characteristics_patch cumulative and merge-friendly. Do not include user_id/chat_id inside patch.
`.trim();

/**
 * Разбор периода как в summary-команде.
 * Пустое значение трактуется как 1w, то есть 7 дней.
 * @param {String} text
 * @returns {{interval: String, label: String, rest: String}}
 */
export function parseMemoryRecalcPeriod(text){
	const clean = String(text || '').trim().replace(/\n/igm, '\\n');
	const arr   = /^(?:(\d+)([hmwd]))?\s*([\s\S]*)$/im.exec(clean);

	let amount = 1;
	let period = 'w';
	if(arr?.[1] && arr?.[2]){
		amount = parseInt(arr[1], 10);
		period = arr[2].toLowerCase();
	}

	if(!Number.isFinite(amount) || amount <= 0){
		amount = 1;
		period = 'w';
	}

	switch(period){
		case 'm':
			return {interval: `${amount} MINUTE`, label: `${amount}m`, rest: (arr?.[3] || '').replace(/\\n/igm, '\n').trim()};

		case 'h':
			return {interval: `${amount} HOUR`, label: `${amount}h`, rest: (arr?.[3] || '').replace(/\\n/igm, '\n').trim()};

		case 'd':
			return {interval: `${amount} DAY`, label: `${amount}d`, rest: (arr?.[3] || '').replace(/\\n/igm, '\n').trim()};

		case 'w':
		default:
			return {interval: `${amount * 7} DAY`, label: `${amount}w`, rest: (arr?.[3] || '').replace(/\\n/igm, '\n').trim()};
	}
}

/**
 * Получение всех текстовых сообщений чата за период для batch-пересчёта памяти.
 * Сообщения ассистента возвращаются как роль assistant и используются только как контекст.
 * @param {Number} chat_id
 * @param {Number} bot_id
 * @param {String} interval
 * @returns {Promise<Object[]>}
 */
async function getChatMessagesForMemoryRecalc(chat_id, bot_id, interval){
	const res = await db.query(`
        SELECT M.MESSAGE_ID,
               M.USER_ID,
               U.USERNAME,
               U.FIRST_NAME,
               U.LAST_NAME,
               M.MESSAGE ->> 'text'                                       AS MESSAGE_TEXT,
               (M.MESSAGE -> 'reply_to_message' ->> 'message_id')::BIGINT AS REPLY_ID,
               M.TIMESTAMP                                                AS TS
        FROM MESSAGES M
                 JOIN USERS U ON M.USER_ID = U.ID
        WHERE M.CHAT_ID = $1::BIGINT
          AND M.TIMESTAMP > NOW() - ($2::TEXT)::INTERVAL
          AND COALESCE(M.MESSAGE ->> 'text', '') <> ''
        ORDER BY M.TIMESTAMP ASC, M.MESSAGE_ID ASC;`, [chat_id, interval]);

	return res?.rows?.map(row => ({
		message_id: row.message_id,
		reply_to: row.reply_id,
		user_id: Number(row.user_id),
		username: row.username || null,
		first_name: row.first_name || null,
		last_name: row.last_name || null,
		role: Number(row.user_id) === Number(bot_id) ? 'assistant' : 'user',
		timestamp: row.ts,
		content: row.message_text
	})).filter(row => !!row?.content) || [];
}

/**
 * Формирование списка пользователей, для которых разрешён расчёт.
 * @param {Object[]} messages
 * @param {Number} bot_id
 * @returns {Map<Number,Object>}
 */
function collectParticipants(messages, bot_id){
	const participants = new Map();
	messages.forEach(message => {
		if(message.role === 'assistant' || Number(message.user_id) === Number(bot_id)){
			return;
		}

		if(!participants.has(message.user_id)){
			participants.set(message.user_id, {
				user_id: message.user_id,
				username: message.username,
				first_name: message.first_name,
				last_name: message.last_name
			});
		}
	});
	return participants;
}

/**
 * Контекст для записи памяти от имени конкретного участника текущего чата.
 * @param {CTX} base_ctx
 * @param {Object} chat
 * @param {Object} participant
 * @returns {Object}
 */
function makeParticipantCtx(base_ctx, chat, participant){
	const user = {
		id: participant.user_id,
		username: participant.username,
		first_name: participant.first_name,
		last_name: participant.last_name
	};

	return {
		...base_ctx,
		from: user,
		update: {
			message: {
				message_id: 0,
				chat: {id: chat.id, type: chat.type, title: chat.title},
				from: user,
				text: ''
			}
		}
	};
}

/**
 * Безопасный разбор JSON-ответа AI.
 * @param {String} content
 * @returns {?Object}
 */
function parseAIJSON(content){
	const text = stripJsonFence(content);
	try{
		return JSON.parse(text);
	}catch(err){
		const arr = /\{[\s\S]*\}/m.exec(text);
		if(arr?.[0]){
			try{
				return JSON.parse(arr[0]);
			}catch(err2){
				logger.warn(`Не удалось разобрать JSON пересчёта памяти: ${err2?.message ?? err2}`).then();
			}
		}
		logger.warn(`Не удалось разобрать JSON пересчёта памяти: ${err?.message ?? err}`).then();
		return null;
	}
}

/**
 * Нормализация memory item от AI.
 * @param {Object} item
 * @returns {?Object}
 */
function normalizeExtractedMemoryItem(item){
	if(!isPlainObject(item)){
		return null;
	}

	const text = String(item.text || item.content || '').trim();
	if(!text){
		return null;
	}

	return {
		type: String(item.type || 'ai_extracted').trim() || 'ai_extracted',
		text: text.slice(0, 1200),
		data: isPlainObject(item.data) ? item.data : {},
		source: 'admin_memory_recalculate',
		confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.6
	};
}

/**
 * Применение результата AI для одного пользователя.
 * @param {CTX} ctx
 * @param {Object} chat
 * @param {Object} participant
 * @param {Object} user_result
 * @param {String} interval_label
 * @returns {Promise<Object>}
 */
async function applyUserResult(ctx, chat, participant, user_result, interval_label){
	const user_ctx = makeParticipantCtx(ctx, chat, participant);
	const result = {
		user_id: participant.user_id,
		memory_stored: 0,
		characteristics_patched: false,
		errors: []
	};

	const memory_items = (Array.isArray(user_result.memory) ? user_result.memory : user_result.memory_items)
		?.map(normalizeExtractedMemoryItem)
		.filter(item => !!item)
		.slice(0, 20) || [];

	if(memory_items.length > 0){
		const memory_res = await memory_db.setUserMemory(user_ctx, {items: memory_items});
		if(memory_res?.ok === true){
			result.memory_stored = memory_res.stored_count || memory_items.length;
		}else{
			result.errors.push(`memory:${memory_res?.error || 'unknown_error'}`);
		}
	}

	const patch = isPlainObject(user_result.characteristics_patch)
		? user_result.characteristics_patch
		: (isPlainObject(user_result.characteristics) ? user_result.characteristics : null);

	if(patch && Object.keys(patch).length > 0){
		const observations = Array.isArray(user_result.observations) ? user_result.observations : [];
		const char_res = await memory_db.patchUserCharacteristics(user_ctx, {
			patch,
			evidence: `Admin forced chat memory recalculation for ${interval_label}`,
			confidence: Number.isFinite(Number(user_result.confidence)) ? Math.max(0, Math.min(1, Number(user_result.confidence))) : 0.6,
			observations
		});
		if(char_res?.ok === true){
			result.characteristics_patched = true;
		}else{
			result.errors.push(`characteristics:${char_res?.error || 'unknown_error'}`);
		}
	}

	return result;
}

/**
 * Принудительный накопительный пересчёт памяти и характеристик участников чата.
 * @param {CTX} ctx
 * @param {String} period_text
 * @returns {Promise<Object>}
 */
export async function recalculateChatUsersMemory(ctx, period_text = ''){
	if(!deepseek.isAIAllowed()){
		return {ok: false, error: 'ai_unavailable'};
	}

	const chat = ctx?.update?.message?.chat || ctx?.message?.chat;
	const bot_id = ctx?.botInfo?.id;
	if(!chat?.id || !bot_id){
		return {ok: false, error: 'chat_or_bot_not_found'};
	}

	const period = parseMemoryRecalcPeriod(period_text);
	const messages = await getChatMessagesForMemoryRecalc(chat.id, bot_id, period.interval);
	const participants = collectParticipants(messages, bot_id);

	if(messages.length === 0 || participants.size === 0){
		return {
			ok: true,
			interval: period.label,
			message_count: messages.length,
			users_seen: participants.size,
			users_updated: 0,
			memory_stored: 0,
			characteristics_patched: 0,
			note: 'nothing_to_process'
		};
	}

	const payload = {
		chat: {id: chat.id, type: chat.type, title: chat.title || null},
		period: {label: period.label, interval: period.interval},
		participants: Array.from(participants.values()),
		messages: messages.map(message => ({
			message_id: message.message_id,
			reply_to: message.reply_to,
			role: message.role,
			user_id: message.user_id,
			username: message.username,
			first_name: message.first_name,
			last_name: message.last_name,
			timestamp: message.timestamp,
			content: message.content
		}))
	};

	const answer = await deepseek.sendMessages2AI(
		ctx,
		deepseek.AI_ID,
		[{role: 'user', content: json2string(payload, 2)}],
		chat.id,
		true,
		MEMORY_RECALC_QUERY_KIND,
		MEMORY_RECALC_SYSTEM_PROMPT
	);

	const parsed = parseAIJSON(answer?.content || '');
	const users = Array.isArray(parsed?.users) ? parsed.users : [];
	if(users.length === 0){
		return {
			ok: false,
			error: 'empty_ai_result',
			interval: period.label,
			message_count: messages.length,
			users_seen: participants.size
		};
	}

	const results = [];
	for(const user_result of users){
		const user_id = Number(user_result?.user_id);
		if(!participants.has(user_id)){
			results.push({user_id, skipped: true, reason: 'not_a_chat_participant'});
			continue;
		}

		results.push(await applyUserResult(ctx, chat, participants.get(user_id), user_result, period.label));
	}

	return {
		ok: true,
		interval: period.label,
		message_count: messages.length,
		users_seen: participants.size,
		users_updated: results.filter(row => !row.skipped && (row.memory_stored > 0 || row.characteristics_patched)).length,
		memory_stored: results.reduce((sum, row) => sum + (row.memory_stored || 0), 0),
		characteristics_patched: results.filter(row => row.characteristics_patched).length,
		results
	};
}
