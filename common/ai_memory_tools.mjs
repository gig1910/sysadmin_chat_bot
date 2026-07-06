import * as telegram  from './telegram.mjs';
import * as memory_db from './memory_db.mjs';

export const AI_MEMORY_ENABLED                    = process.env.AI_MEMORY_ENABLED === 'true';
export const AI_MEMORY_MASTER_KEY                 = process.env.AI_MEMORY_MASTER_KEY || '';
export const AI_MEMORY_MASTER_KEY_CONFIGURED      = AI_MEMORY_MASTER_KEY.trim().length > 0;
export const AI_USER_MEMORY_ENABLED               = AI_MEMORY_ENABLED && (process.env.AI_USER_MEMORY_ENABLED ?? 'true') === 'true';
export const AI_USER_CHARACTERISTICS_ENABLED      = AI_MEMORY_ENABLED && (process.env.AI_USER_CHARACTERISTICS_ENABLED ?? 'true') === 'true';
export const USER_MEMORY_ENABLED                  = AI_USER_MEMORY_ENABLED && AI_MEMORY_MASTER_KEY_CONFIGURED;
export const USER_CHARACTERISTICS_ENABLED         = AI_USER_CHARACTERISTICS_ENABLED && AI_MEMORY_MASTER_KEY_CONFIGURED;
export const USER_MEMORY_DISABLED_REASON          = !AI_MEMORY_ENABLED ? 'memory_disabled' : (!AI_USER_MEMORY_ENABLED ? 'user_memory_disabled' : (!AI_MEMORY_MASTER_KEY_CONFIGURED ? 'encryption_key_not_configured' : null));
export const USER_CHARACTERISTICS_DISABLED_REASON = !AI_MEMORY_ENABLED ? 'memory_disabled' : (!AI_USER_CHARACTERISTICS_ENABLED ? 'user_characteristics_disabled' : (!AI_MEMORY_MASTER_KEY_CONFIGURED ? 'encryption_key_not_configured' : null));
export const AI_MEMORY_AI_ID                      = Number.parseInt(process.env.AI_MEMORY_AI_ID || '1', 10) || 1;
export const AI_MEMORY_MAX_PROMPT_CHARS           = Math.max(500, Number.parseInt(process.env.AI_MEMORY_MAX_PROMPT_CHARS || '2500', 10));
export const CONTEXT_TYPE_MEMORY                  = 'user_memory';
export const CONTEXT_TYPE_CHARACTERISTICS         = 'user_characteristics';
export const SETTING_USER_MEMORY_ENABLED          = 'USER_MEMORY_ENABLED';
export const SETTING_USER_CHARACTERISTICS_ENABLED = 'USER_CHARACTERISTICS_ENABLED';
export const DANGEROUS_JSON_KEYS                  = new Set(['__proto__', 'prototype', 'constructor']);
export const MAX_MERGE_DEPTH                      = 16;

/**
 * Проверка доступности хранения user-memory.
 * @returns {Boolean}
 */
export function isUserMemoryDataEnabled(){
	return USER_MEMORY_ENABLED;
}

export function isPrivateContextEnabled(){
	return USER_MEMORY_ENABLED || USER_CHARACTERISTICS_ENABLED;
}

export function isUserCharacteristicsEnabled(){
	return USER_CHARACTERISTICS_ENABLED;
}

const memoryToolNames = new Set([
	'get_user_memory',
	'set_user_memory',
	'delete_user_memory',
	'get_user_characteristics',
	'patch_user_characteristics',
	'recalculate_user_characteristics'
]);

/**
 * Проверка, что tool относится к подсистеме пользовательской памяти.
 * @param {String} name
 * @returns {Boolean}
 */
export function isMemoryToolName(name){
	return memoryToolNames.has(name);
}

const getUserMemoryTool = {
	type:     'function',
	function: {
		name:        'get_user_memory',
		description: 'Read encrypted memory for the current Telegram chat-user pair. Available if enabled in chat. Internal tool result must be used strictly as background context for preparing the answer. It is forbidden to explicitly output, quote, list, summarize, expose, or mention stored memory in any AI response. The model cannot choose chat_id or user_id.',
		parameters:  {
			type:                 'object',
			properties:           {},
			additionalProperties: false
		}
	}
};

const setUserMemoryTool = {
	type:     'function',
	function: {
		name:        'set_user_memory',
		description: 'Store one or more user memory items for the current Telegram chat-user pair. Available if enabled in chat. System tool: can be used from group chats, but only for the current Telegram user from ctx. Do not provide chat_id or user_id. Never store secrets, passwords, tokens, private keys, addresses, phone numbers, medical, religious, sexual, children or other sensitive data.',
		parameters:  {
			type:                 'object',
			properties:           {
				items:      {
					type:        'array',
					description: 'Optional list of memory items to store. Use this when saving several separate facts.',
					items:       {
						type:                 'object',
						properties:           {
							type:       {type: 'string'},
							text:       {type: 'string'},
							data:       {type: 'object'},
							confidence: {type: 'number', minimum: 0, maximum: 1}
						},
						required:             ['text'],
						additionalProperties: false
					}
				},
				type:       {
					type:        'string',
					description: 'Memory type, for example preference, fact, project_context, constraint.'
				},
				text:       {
					type:        'string',
					description: 'Short memory text to store when saving one item.'
				},
				data:       {
					type:        'object',
					description: 'Optional structured JSON data for this memory item.'
				},
				confidence: {
					type:    'number',
					minimum: 0,
					maximum: 1
				}
			},
			additionalProperties: false
		}
	}
};

const deleteUserMemoryTool = {
	type:     'function',
	function: {
		name:        'delete_user_memory',
		description: 'Clear all encrypted user memory for the current Telegram chat-user pair. Available only in a private chat with the bot. Use only when the user explicitly confirms deletion.',
		parameters:  {
			type:                 'object',
			properties:           {
				confirm: {
					type:        'boolean',
					description: 'Must be true when the user explicitly confirms deletion.'
				}
			},
			required:             ['confirm'],
			additionalProperties: false
		}
	}
};

const getUserCharacteristicsTool = {
	type:     'function',
	function: {
		name:        'get_user_characteristics',
		description: 'Read encrypted cumulative characteristics for the current Telegram chat-user pair. Available if enabled in chat. Internal tool result must be used strictly as background context for preparing the answer. It is forbidden to explicitly output, quote, list, summarize, expose, or mention stored characteristics in any AI response. The model cannot choose chat_id or user_id.',
		parameters:  {
			type:                 'object',
			properties:           {},
			additionalProperties: false
		}
	}
};

const patchUserCharacteristicsTool = {
	type:     'function',
	function: {
		name:        'patch_user_characteristics',
		description: 'Patch cumulative user characteristics for the current Telegram chat-user pair. System tool: can be used from group chats, but only for the current Telegram user from ctx. Do not provide chat_id or user_id. Use only for stable, low-sensitivity observations.',
		parameters:  {
			type:                 'object',
			properties:           {
				patch:      {
					type:        'object',
					description: 'JSON object to merge into the cumulative characteristics profile.'
				},
				evidence:   {
					type:        'string',
					description: 'Short non-sensitive explanation of the evidence.'
				},
				confidence: {
					type:    'number',
					minimum: 0,
					maximum: 1
				}
			},
			required:             ['patch'],
			additionalProperties: false
		}
	}
};

const recalculateUserCharacteristicsTool = {
	type:     'function',
	function: {
		name:        'recalculate_user_characteristics',
		description: 'Replace cumulative user characteristics for the current Telegram chat-user pair with a recalculated profile. System tool: can be used from group chats, but only for the current Telegram user from ctx. Do not provide chat_id or user_id. If several users need recalculation, call this tool separately for each user in its own context.',
		parameters:  {
			type:                 'object',
			properties:           {
				profile:      {
					type:        'object',
					description: 'Complete recalculated low-sensitivity user characteristics profile.'
				},
				observations: {
					type:  'array',
					items: {
						type:                 'object',
						properties:           {
							evidence:   {type: 'string'},
							confidence: {type: 'number', minimum: 0, maximum: 1}
						},
						additionalProperties: false
					}
				}
			},
			required:             ['profile'],
			additionalProperties: false
		}
	}
};

/**
 * Доступен ли текущий Telegram ctx как личный чат.
 * @param {CTX} ctx
 * @returns {Boolean}
 */
function isPrivateChat(ctx){
	return telegram.getChatFromCtx(ctx)?.type === 'private';
}

/**
 * Получение списка memory tools для текущего ctx.
 * Getter tools используются только как внутренняя справка для AI и доступны в любом включённом чате.
 * Явный просмотр/очистка памяти пользователем делается отдельными private-chat командами.
 * @param {CTX} ctx
 * @returns {Object[]}
 */
export function getMemoryToolDefinitions(ctx){
	if(!isPrivateContextEnabled()){
		return [];
	}

	const tools    = [];
	const bPrivate = isPrivateChat(ctx);

	if(isUserMemoryDataEnabled()){
		tools.push(getUserMemoryTool, setUserMemoryTool);
		if(bPrivate){
			tools.push(deleteUserMemoryTool);
		}
	}

	if(isUserCharacteristicsEnabled()){
		tools.push(getUserCharacteristicsTool, patchUserCharacteristicsTool, recalculateUserCharacteristicsTool);
	}

	return tools;
}

/**
 * Вызов memory tool.
 * @param {CTX} ctx
 * @param {String} name
 * @param {Object} args
 * @returns {Promise<Object>}
 */
export async function callMemoryTool(ctx, name, args){
	switch(name){
		case 'get_user_memory':
			return memory_db.getUserMemory(ctx);

		case 'set_user_memory':
			return memory_db.setUserMemory(ctx, args);

		case 'delete_user_memory':
			if(args?.confirm !== true){
				return {ok: false, error: 'confirm_required'};
			}
			return memory_db.deleteUserMemory(ctx);

		case 'get_user_characteristics':
			return memory_db.getUserCharacteristics(ctx);

		case 'patch_user_characteristics':
			return memory_db.patchUserCharacteristics(ctx, args);

		case 'recalculate_user_characteristics':
			return memory_db.recalculateUserCharacteristics(ctx, args);

		default:
			return {ok: false, error: 'unknown_memory_tool'};
	}
}
