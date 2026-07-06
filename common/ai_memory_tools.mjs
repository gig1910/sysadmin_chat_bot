import * as telegram from './telegram.mjs';
import {
	deleteUserMemory,
	getUserCharacteristics,
	getUserMemory,
	isPrivateContextEnabled,
	isUserCharacteristicsEnabled,
	isUserMemoryDataEnabled,
	patchUserCharacteristics,
	recalculateUserCharacteristics,
	setUserMemory
} from './memory_db.mjs';

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
	type: 'function',
	function: {
		name: 'get_user_memory',
		description: 'Read encrypted memory for the current Telegram chat-user pair. Available only if enabled in chat. The model cannot choose chat_id or user_id.',
		parameters: {
			type: 'object',
			properties: {},
			additionalProperties: false
		}
	}
};

const setUserMemoryTool = {
	type: 'function',
	function: {
		name: 'set_user_memory',
		description: 'Store one or more user memory items for the current Telegram chat-user pair. Available only in a private chat with the bot. Never store secrets, passwords, tokens, private keys, addresses, phone numbers, medical, religious, sexual, children or other sensitive data.',
		parameters: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					description: 'Optional list of memory items to store. Use this when saving several separate facts.',
					items: {
						type: 'object',
						properties: {
							type: {type: 'string'},
							text: {type: 'string'},
							data: {type: 'object'},
							confidence: {type: 'number', minimum: 0, maximum: 1}
						},
						required: ['text'],
						additionalProperties: false
					}
				},
				type: {
					type: 'string',
					description: 'Memory type, for example preference, fact, project_context, constraint.'
				},
				text: {
					type: 'string',
					description: 'Short memory text to store when saving one item.'
				},
				data: {
					type: 'object',
					description: 'Optional structured JSON data for this memory item.'
				},
				confidence: {
					type: 'number',
					minimum: 0,
					maximum: 1
				}
			},
			additionalProperties: false
		}
	}
};

const deleteUserMemoryTool = {
	type: 'function',
	function: {
		name: 'delete_user_memory',
		description: 'Clear all encrypted user memory for the current Telegram chat-user pair. Available only in a private chat with the bot. Use only when the user explicitly confirms deletion.',
		parameters: {
			type: 'object',
			properties: {
				confirm: {
					type: 'boolean',
					description: 'Must be true when the user explicitly confirms deletion.'
				}
			},
			required: ['confirm'],
			additionalProperties: false
		}
	}
};

const getUserCharacteristicsTool = {
	type: 'function',
	function: {
		name: 'get_user_characteristics',
		description: 'Read encrypted cumulative characteristics for the current Telegram chat-user pair. Available only in a private chat with the bot. Use to adapt style and continuity, not to reveal private data.',
		parameters: {
			type: 'object',
			properties: {},
			additionalProperties: false
		}
	}
};

const patchUserCharacteristicsTool = {
	type: 'function',
	function: {
		name: 'patch_user_characteristics',
		description: 'Patch cumulative user characteristics for the current Telegram chat-user pair. System tool: can be used from group chats, but only for the current Telegram user from ctx. Do not provide chat_id or user_id. Use only for stable, low-sensitivity observations.',
		parameters: {
			type: 'object',
			properties: {
				patch: {
					type: 'object',
					description: 'JSON object to merge into the cumulative characteristics profile.'
				},
				evidence: {
					type: 'string',
					description: 'Short non-sensitive explanation of the evidence.'
				},
				confidence: {
					type: 'number',
					minimum: 0,
					maximum: 1
				}
			},
			required: ['patch'],
			additionalProperties: false
		}
	}
};

const recalculateUserCharacteristicsTool = {
	type: 'function',
	function: {
		name: 'recalculate_user_characteristics',
		description: 'Replace cumulative user characteristics for the current Telegram chat-user pair with a recalculated profile. System tool: can be used from group chats, but only for the current Telegram user from ctx. Do not provide chat_id or user_id. If several users need recalculation, call this tool separately for each user in its own context.',
		parameters: {
			type: 'object',
			properties: {
				profile: {
					type: 'object',
					description: 'Complete recalculated low-sensitivity user characteristics profile.'
				},
				observations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							evidence: {type: 'string'},
							confidence: {type: 'number', minimum: 0, maximum: 1}
						},
						additionalProperties: false
					}
				}
			},
			required: ['profile'],
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
 * Чтение памяти доступно в любом чате, где память включена.
 * Изменение/очистка памяти пока выдаётся только в личке.
 * Системные tools характеристик доступны и в группе.
 * @param {CTX} ctx
 * @returns {Object[]}
 */
export function getMemoryToolDefinitions(ctx){
	if(!isPrivateContextEnabled()){
		return [];
	}

	const tools = [];
	const bPrivate = isPrivateChat(ctx);

	if(isUserMemoryDataEnabled()){
		tools.push(getUserMemoryTool);
		if(bPrivate){
			tools.push(setUserMemoryTool, deleteUserMemoryTool);
		}
	}

	if(isUserCharacteristicsEnabled()){
		if(bPrivate){
			tools.push(getUserCharacteristicsTool);
		}
		tools.push(patchUserCharacteristicsTool, recalculateUserCharacteristicsTool);
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
			return getUserMemory(ctx);

		case 'set_user_memory':
			return setUserMemory(ctx, args);

		case 'delete_user_memory':
			if(args?.confirm !== true){
				return {ok: false, error: 'confirm_required'};
			}
			return deleteUserMemory(ctx);

		case 'get_user_characteristics':
			return getUserCharacteristics(ctx);

		case 'patch_user_characteristics':
			return patchUserCharacteristics(ctx, args);

		case 'recalculate_user_characteristics':
			return recalculateUserCharacteristics(ctx, args);

		default:
			return {ok: false, error: 'unknown_memory_tool'};
	}
}
