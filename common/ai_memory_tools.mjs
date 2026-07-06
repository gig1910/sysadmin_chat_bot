import {
	deleteUserMemory,
	getUserCharacteristics,
	getUserMemory,
	isUserMemoryEnabled,
	patchUserCharacteristics,
	queueUserCharacteristicsRecalc,
	setUserMemory
} from './memory_db.mjs';

const memoryToolNames = new Set([
	'get_user_memory',
	'set_user_memory',
	'delete_user_memory',
	'get_user_characteristics',
	'patch_user_characteristics',
	'queue_user_characteristics_recalc'
]);

export function isMemoryToolName(name){
	return memoryToolNames.has(name);
}

const getUserMemoryTool = {
	type: 'function',
	function: {
		name: 'get_user_memory',
		description: 'Read encrypted memory for the current Telegram chat-user pair. The model cannot choose chat_id or user_id. Use only when user-specific preferences or saved context are relevant.',
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
		description: 'Store a user memory item for the current Telegram chat-user pair. Use when the user explicitly asks to remember/consider something, or when a stable preference is clearly stated. Never store secrets, passwords, tokens, private keys, addresses, phone numbers, medical, religious, sexual, children or other sensitive data.',
		parameters: {
			type: 'object',
			properties: {
				type: {
					type: 'string',
					description: 'Memory type, for example preference, fact, project_context, constraint.'
				},
				text: {
					type: 'string',
					description: 'Short memory text to store.'
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
			required: ['text'],
			additionalProperties: false
		}
	}
};

const deleteUserMemoryTool = {
	type: 'function',
	function: {
		name: 'delete_user_memory',
		description: 'Clear all encrypted user memory for the current Telegram chat-user pair. Use only when the user explicitly asks to forget/delete stored memory.',
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
		description: 'Read encrypted cumulative characteristics for the current Telegram chat-user pair. Use to adapt style and continuity, not to reveal private data.',
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
		description: 'Patch cumulative user characteristics for the current Telegram chat-user pair. Use only for stable, low-sensitivity observations. Existing characteristics should have priority; conflicting weak observations should reduce confidence rather than overwrite strongly supported facts.',
		parameters: {
			type: 'object',
			properties: {
				patch: {
					type: 'object',
					description: 'JSON patch-like object to merge into the cumulative characteristics profile.'
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

const queueUserCharacteristicsRecalcTool = {
	type: 'function',
	function: {
		name: 'queue_user_characteristics_recalc',
		description: 'Queue a background recalculation of encrypted user characteristics for the current Telegram chat-user pair. Use when the dialogue suggests characteristics should be revisited but immediate patching is uncertain.',
		parameters: {
			type: 'object',
			properties: {
				reason: {type: 'string'},
				priority: {type: 'integer', minimum: 1, maximum: 1000}
			},
			additionalProperties: false
		}
	}
};

export function getMemoryToolDefinitions(){
	if(!isUserMemoryEnabled()){
		return [];
	}

	return [
		getUserMemoryTool,
		setUserMemoryTool,
		deleteUserMemoryTool,
		getUserCharacteristicsTool,
		patchUserCharacteristicsTool,
		queueUserCharacteristicsRecalcTool
	];
}

export async function callMemoryTool(ctx, name, args){
	switch(name){
		case 'get_user_memory':
			return getUserMemory(ctx);

		case 'set_user_memory':
			return setUserMemory(ctx, args);

		case 'delete_user_memory':
			if(args?.confirm !== true){
				throw new Error('delete_user_memory requires confirm=true.');
			}
			return deleteUserMemory(ctx);

		case 'get_user_characteristics':
			return getUserCharacteristics(ctx);

		case 'patch_user_characteristics':
			return patchUserCharacteristics(ctx, args);

		case 'queue_user_characteristics_recalc':
			return queueUserCharacteristicsRecalc(ctx, args);

		default:
			throw new Error(`Unknown memory tool: ${name}`);
	}
}
