import {randomUUID} from 'node:crypto';

import * as db            from './db.mjs';
import * as logger        from './logger.mjs';
import * as telegram      from './telegram.mjs';
import * as telegram_db   from './telegram_db.mjs';
import * as memory_config from './ai_memory_config.mjs';
import {hasLikelySecret, redactSecrets} from './private_context_sanitizer.mjs';
import {deepMerge, isPlainObject, json2string, parseBoolSetting} from './utils.mjs';

function getCharacteristicsMergeOptions(){
	return {
		max_depth: memory_config.MAX_MERGE_DEPTH,
		dangerous_keys: memory_config.DANGEROUS_JSON_KEYS,
		on_skip_key: key => logger.warn(`Пропущен опасный ключ characteristics patch: ${key}`).then()
	};
}

function getGlobalContextState(context_type){
	switch(context_type){
		case memory_config.CONTEXT_TYPE_MEMORY:
			return {enabled: memory_config.USER_MEMORY_ENABLED, reason: memory_config.USER_MEMORY_DISABLED_REASON};

		case memory_config.CONTEXT_TYPE_CHARACTERISTICS:
			return {enabled: memory_config.USER_CHARACTERISTICS_ENABLED, reason: memory_config.USER_CHARACTERISTICS_DISABLED_REASON};

		default:
			return {enabled: false, reason: 'unknown_context_type'};
	}
}

async function getChatPrivateContextSettings(chat_id){
	const settings = await telegram_db.getChatAISettingsMapByChatId(
		chat_id,
		memory_config.AI_MEMORY_AI_ID,
		false,
		[memory_config.SETTING_USER_MEMORY_ENABLED, memory_config.SETTING_USER_CHARACTERISTICS_ENABLED]
	);

	return {
		user_memory_enabled: parseBoolSetting(
			settings[memory_config.SETTING_USER_MEMORY_ENABLED],
			true,
			value => logger.warn(`Некорректное boolean-значение AI2CHAT_SETTINGS. chat_id=${chat_id}; type=${memory_config.SETTING_USER_MEMORY_ENABLED}; value=${value}`).then()
		),
		user_characteristics_enabled: parseBoolSetting(
			settings[memory_config.SETTING_USER_CHARACTERISTICS_ENABLED],
			true,
			value => logger.warn(`Некорректное boolean-значение AI2CHAT_SETTINGS. chat_id=${chat_id}; type=${memory_config.SETTING_USER_CHARACTERISTICS_ENABLED}; value=${value}`).then()
		)
	};
}

async function checkPrivateContextAccess(ctx, context_type, operation, bRequirePrivate = true, bWarn = true){
	const global_state = getGlobalContextState(context_type);
	if(global_state.enabled !== true){
		if(bWarn){
			logger.warn(`Операция ${operation} отключена глобальными настройками. context_type=${context_type}; reason=${global_state.reason}`).then();
		}
		return {enabled: false, reason: global_state.reason, identity: null};
	}

	const identity = telegram.getContextIdentity(ctx, bWarn, 'Не удалось определить текущий chat-user для приватной памяти.');
	if(!identity?.chat_id || !identity?.user_id){
		return {enabled: false, reason: 'context_identity_not_found', identity};
	}

	if(bRequirePrivate && !telegram.checkPrivateChat(identity, operation, bWarn)){
		return {enabled: false, reason: 'private_chat_required', identity};
	}

	if(!await telegram_db.checkUserChatExists(identity.chat_id, identity.user_id)){
		return {enabled: false, reason: 'chat_or_user_not_found', identity};
	}

	const chat_settings = await getChatPrivateContextSettings(identity.chat_id);
	if(context_type === memory_config.CONTEXT_TYPE_MEMORY && chat_settings.user_memory_enabled !== true){
		if(bWarn){
			logger.warn(`User-memory отключена для чата. chat_id=${identity.chat_id}; user_id=${identity.user_id}`).then();
		}
		return {enabled: false, reason: 'user_memory_disabled_for_chat', identity};
	}

	if(context_type === memory_config.CONTEXT_TYPE_CHARACTERISTICS && chat_settings.user_characteristics_enabled !== true){
		if(bWarn){
			logger.warn(`User-characteristics отключены для чата. chat_id=${identity.chat_id}; user_id=${identity.user_id}`).then();
		}
		return {enabled: false, reason: 'user_characteristics_disabled_for_chat', identity};
	}

	return {enabled: true, reason: null, identity};
}

function getAccessIdentity(access, operation){
	if(!access?.identity?.chat_id || !access?.identity?.user_id){
		logger.warn(`Операция ${operation} получила access.enabled=true без корректного identity. chat_id=${access?.identity?.chat_id}; user_id=${access?.identity?.user_id}`).then();
		return null;
	}

	return access.identity;
}

async function checkStorageReady(context_type, chat_id, user_id){
	const global_state = getGlobalContextState(context_type);
	if(global_state.enabled !== true){
		logger.warn(`Прямая операция с pgcrypto-хранилищем запрещена. context_type=${context_type}; reason=${global_state.reason}`).then();
		return false;
	}

	return telegram_db.checkUserChatExists(chat_id, user_id);
}

function defaultMemoryData(){
	return {
		items: [],
		updated_at: new Date().toISOString()
	};
}

function defaultCharacteristicsData(){
	return {
		profile: {},
		observations: [],
		updated_at: new Date().toISOString()
	};
}

function checkDecryptedData(data, context_type, chat_id, user_id){
	if(!isPlainObject(data)){
		logger.warn(`Ошибка расшифровки ${context_type}: на выходе не JSON-объект. chat_id=${chat_id}; user_id=${user_id}`).then();
		return null;
	}
	return data;
}

async function readUserMemoryRow(chat_id, user_id){
	if(!await checkStorageReady(memory_config.CONTEXT_TYPE_MEMORY, chat_id, user_id)){
		return null;
	}

	const res = await db.query(
		`SELECT ENABLED,
                VERSION,
                UPDATED_AT,
                CASE WHEN ENABLED IS TRUE THEN
                    PGP_SYM_DECRYPT(
                        DATA_ENC,
                        ENCODE(DIGEST($3::TEXT || ':' || CHAT_ID::TEXT || ':' || USER_ID::TEXT || ':' || $4::TEXT, 'sha256'), 'hex')
                    )::JSONB
                ELSE NULL END AS DATA
         FROM USER_MEMORY
         WHERE CHAT_ID = $1::BIGINT
           AND USER_ID = $2::BIGINT;`,
		[chat_id, user_id, memory_config.AI_MEMORY_MASTER_KEY, memory_config.CONTEXT_TYPE_MEMORY]
	);

	if(!res){
		logger.warn(`Ошибка чтения USER_MEMORY через pgcrypto. chat_id=${chat_id}; user_id=${user_id}`).then();
		return null;
	}

	const row = res?.rows?.[0] || null;
	if(row?.enabled === true){
		row.data = checkDecryptedData(row.data, memory_config.CONTEXT_TYPE_MEMORY, chat_id, user_id);
		if(!row.data){
			row.enabled = false;
			row.reason = 'decrypt_error';
		}
	}
	return row;
}

async function readUserCharacteristicsRow(chat_id, user_id){
	if(!await checkStorageReady(memory_config.CONTEXT_TYPE_CHARACTERISTICS, chat_id, user_id)){
		return null;
	}

	const res = await db.query(
		`SELECT ENABLED,
                VERSION,
                UPDATED_AT,
                CASE WHEN ENABLED IS TRUE THEN
                    PGP_SYM_DECRYPT(
                        DATA_ENC,
                        ENCODE(DIGEST($3::TEXT || ':' || CHAT_ID::TEXT || ':' || USER_ID::TEXT || ':' || $4::TEXT, 'sha256'), 'hex')
                    )::JSONB
                ELSE NULL END AS DATA
         FROM USER_CHARACTERISTICS
         WHERE CHAT_ID = $1::BIGINT
           AND USER_ID = $2::BIGINT;`,
		[chat_id, user_id, memory_config.AI_MEMORY_MASTER_KEY, memory_config.CONTEXT_TYPE_CHARACTERISTICS]
	);

	if(!res){
		logger.warn(`Ошибка чтения USER_CHARACTERISTICS через pgcrypto. chat_id=${chat_id}; user_id=${user_id}`).then();
		return null;
	}

	const row = res?.rows?.[0] || null;
	if(row?.enabled === true){
		row.data = checkDecryptedData(row.data, memory_config.CONTEXT_TYPE_CHARACTERISTICS, chat_id, user_id);
		if(!row.data){
			row.enabled = false;
			row.reason = 'decrypt_error';
		}
	}
	return row;
}

async function upsertUserMemoryRow(chat_id, user_id, data){
	if(!isPlainObject(data)){
		logger.warn('Нельзя сохранить USER_MEMORY: data не является JSON-объектом.').then();
		return null;
	}

	if(!await checkStorageReady(memory_config.CONTEXT_TYPE_MEMORY, chat_id, user_id)){
		return null;
	}

	return db.query(
		`INSERT INTO USER_MEMORY (CHAT_ID, USER_ID, DATA_ENC, ENABLED, UPDATED_AT)
         VALUES (
             $1::BIGINT,
             $2::BIGINT,
             PGP_SYM_ENCRYPT(
                 $3::TEXT,
                 ENCODE(DIGEST($4::TEXT || ':' || $1::BIGINT::TEXT || ':' || $2::BIGINT::TEXT || ':' || $5::TEXT, 'sha256'), 'hex'),
                 'cipher-algo=aes256, compress-algo=1'
             ),
             TRUE,
             NOW()
         )
         ON CONFLICT (CHAT_ID, USER_ID)
             DO UPDATE SET DATA_ENC = EXCLUDED.DATA_ENC,
                           ENABLED = TRUE,
                           VERSION = USER_MEMORY.VERSION + 1,
                           UPDATED_AT = NOW();`,
		[chat_id, user_id, json2string(data), memory_config.AI_MEMORY_MASTER_KEY, memory_config.CONTEXT_TYPE_MEMORY]
	);
}

async function upsertUserCharacteristicsRow(chat_id, user_id, data){
	if(!isPlainObject(data)){
		logger.warn('Нельзя сохранить USER_CHARACTERISTICS: data не является JSON-объектом.').then();
		return null;
	}

	if(!await checkStorageReady(memory_config.CONTEXT_TYPE_CHARACTERISTICS, chat_id, user_id)){
		return null;
	}

	return db.query(
		`INSERT INTO USER_CHARACTERISTICS (CHAT_ID, USER_ID, DATA_ENC, ENABLED, UPDATED_AT)
         VALUES (
             $1::BIGINT,
             $2::BIGINT,
             PGP_SYM_ENCRYPT(
                 $3::TEXT,
                 ENCODE(DIGEST($4::TEXT || ':' || $1::BIGINT::TEXT || ':' || $2::BIGINT::TEXT || ':' || $5::TEXT, 'sha256'), 'hex'),
                 'cipher-algo=aes256, compress-algo=1'
             ),
             TRUE,
             NOW()
         )
         ON CONFLICT (CHAT_ID, USER_ID)
             DO UPDATE SET DATA_ENC = EXCLUDED.DATA_ENC,
                           ENABLED = TRUE,
                           VERSION = USER_CHARACTERISTICS.VERSION + 1,
                           UPDATED_AT = NOW();`,
		[chat_id, user_id, json2string(data), memory_config.AI_MEMORY_MASTER_KEY, memory_config.CONTEXT_TYPE_CHARACTERISTICS]
	);
}

async function getPrivateData(ctx, context_type, readRowFunc, defaultFactory, bRequirePrivate = true){
	if(typeof readRowFunc !== 'function'){
		logger.warn('getPrivateData: readRowFunc не является функцией.').then();
		return {enabled: false, data: null, reason: 'invalid_read_function'};
	}

	if(typeof defaultFactory !== 'function'){
		logger.warn('getPrivateData: defaultFactory не является функцией.').then();
		return {enabled: false, data: null, reason: 'invalid_default_factory'};
	}

	const access = await checkPrivateContextAccess(ctx, context_type, 'read_private_data', bRequirePrivate, true);
	if(access.enabled !== true){
		return {enabled: false, data: null, reason: access.reason};
	}

	const identity = getAccessIdentity(access, 'read_private_data');
	if(!identity){
		return {enabled: false, data: null, reason: 'invalid_identity'};
	}

	const default_data = defaultFactory();
	if(!isPlainObject(default_data)){
		logger.warn('getPrivateData: defaultFactory вернул не JSON-объект.').then();
		return {enabled: false, data: null, reason: 'invalid_default_data'};
	}

	const row = await readRowFunc(identity.chat_id, identity.user_id);
	if(!row){
		return {enabled: true, data: default_data, updated_at: null};
	}

	if(row.enabled !== true){
		return {
			enabled: false,
			data: null,
			reason: row.reason || 'disabled_for_user_chat',
			updated_at: row.updated_at
		};
	}

	return {
		enabled: true,
		data: row.data,
		updated_at: row.updated_at,
		version: row.version
	};
}

export async function getUserMemory(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_MEMORY, readUserMemoryRow, defaultMemoryData, false);
}

export async function getUserMemoryPrivate(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_MEMORY, readUserMemoryRow, defaultMemoryData, true);
}

async function getUserMemoryForUpdate(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_MEMORY, readUserMemoryRow, defaultMemoryData, false);
}

export async function getUserCharacteristics(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, readUserCharacteristicsRow, defaultCharacteristicsData, false);
}

export async function getUserCharacteristicsPrivate(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, readUserCharacteristicsRow, defaultCharacteristicsData, true);
}

async function getUserCharacteristicsForUpdate(ctx){
	return getPrivateData(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, readUserCharacteristicsRow, defaultCharacteristicsData, false);
}

function normalizeMemoryItem(args){
	const data = args?.data && isPlainObject(args.data) ? args.data : {};
	const text = String(args?.text || args?.content || data.text || '').trim();

	if(!text && Object.keys(data).length === 0){
		throw new Error('Нельзя сохранить пустую запись памяти.');
	}

	if(hasLikelySecret(text) || hasLikelySecret(json2string(data))){
		throw new Error('Отказ от сохранения: данные похожи на секрет, токен, пароль или ключ.');
	}

	return {
		id: String(args?.id || data.id || randomUUID()),
		type: String(args?.type || data.type || 'memory').trim() || 'memory',
		text: redactSecrets(text),
		data,
		source: String(args?.source || 'ai_tool'),
		confidence: Number.isFinite(Number(args?.confidence)) ? Math.max(0, Math.min(1, Number(args.confidence))) : 0.7,
		updated_at: new Date().toISOString()
	};
}

function normalizeMemoryItems(args){
	const raw_items = Array.isArray(args) ? args : (Array.isArray(args?.items) ? args.items : [args]);
	return raw_items.map(normalizeMemoryItem);
}

function ensureMemoryItemIds(data){
	const result = isPlainObject(data) ? data : defaultMemoryData();
	result.items = Array.isArray(result.items) ? result.items : [];
	let changed = false;

	result.items = result.items
		.filter(item => isPlainObject(item))
		.map(item => {
			if(!item.id){
				changed = true;
				return {...item, id: randomUUID()};
			}
			return item;
		});

	return {data: result, changed};
}

export async function setUserMemory(ctx, args){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_MEMORY, 'set_user_memory', false, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'set_user_memory');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	if(args?.chat_id || args?.user_id){
		logger.warn(`setUserMemory: явный chat_id/user_id запрещён. chat_id=${args?.chat_id}; user_id=${args?.user_id}`).then();
		return {ok: false, error: 'explicit_identity_forbidden'};
	}

	const current = await getUserMemoryForUpdate(ctx);
	if(current.enabled !== true){
		return {ok: false, error: current.reason || 'memory_unavailable'};
	}

	let items;
	try{
		items = normalizeMemoryItems(args);
	}catch(err){
		logger.warn(err).then();
		return {ok: false, error: 'invalid_memory_item'};
	}

	const {data} = ensureMemoryItemIds(current.data || defaultMemoryData());
	data.items = data.items.concat(items);
	data.updated_at = new Date().toISOString();

	await upsertUserMemoryRow(identity.chat_id, identity.user_id, data);
	return {ok: true, stored: true, item_count: data.items.length, stored_count: items.length};
}

export async function listUserMemoryItemsPrivate(ctx){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_MEMORY, 'list_user_memory_items', true, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason, items: []};
	}

	const identity = getAccessIdentity(access, 'list_user_memory_items');
	if(!identity){
		return {ok: false, error: 'invalid_identity', items: []};
	}

	const current = await getUserMemoryPrivate(ctx);
	if(current.enabled !== true){
		return {ok: false, error: current.reason || 'memory_unavailable', items: []};
	}

	const {data, changed} = ensureMemoryItemIds(current.data || defaultMemoryData());
	if(changed){
		data.updated_at = new Date().toISOString();
		await upsertUserMemoryRow(identity.chat_id, identity.user_id, data);
	}

	return {ok: true, items: data.items, item_count: data.items.length};
}

export async function updateUserMemoryItemPrivate(ctx, item_id, args){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_MEMORY, 'update_user_memory_item', true, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'update_user_memory_item');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	const id = String(item_id || '').trim();
	if(!id){
		return {ok: false, error: 'item_id_required'};
	}

	const current = await getUserMemoryPrivate(ctx);
	if(current.enabled !== true){
		return {ok: false, error: current.reason || 'memory_unavailable'};
	}

	const {data} = ensureMemoryItemIds(current.data || defaultMemoryData());
	const index = data.items.findIndex(item => item?.id === id);
	if(index < 0){
		return {ok: false, error: 'memory_item_not_found'};
	}

	const old_item = data.items[index];
	const new_item = {...old_item, updated_at: new Date().toISOString()};

	if(args?.text != null){
		new_item.text = redactSecrets(String(args.text || '').trim());
	}

	if(args?.type != null){
		new_item.type = String(args.type || 'memory').trim() || 'memory';
	}

	if(args?.data != null){
		if(!isPlainObject(args.data)){
			return {ok: false, error: 'invalid_data'};
		}
		new_item.data = args.data;
	}

	if(args?.confidence != null){
		new_item.confidence = Number.isFinite(Number(args.confidence)) ? Math.max(0, Math.min(1, Number(args.confidence))) : old_item.confidence;
	}

	if(!new_item.text && (!isPlainObject(new_item.data) || Object.keys(new_item.data).length === 0)){
		return {ok: false, error: 'empty_memory_item'};
	}

	if(hasLikelySecret(new_item.text) || hasLikelySecret(json2string(new_item.data))){
		return {ok: false, error: 'secret_like_data'};
	}

	data.items[index] = new_item;
	data.updated_at = new Date().toISOString();

	await upsertUserMemoryRow(identity.chat_id, identity.user_id, data);
	return {ok: true, updated: true, item: new_item};
}

export async function deleteUserMemoryItemPrivate(ctx, item_id){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_MEMORY, 'delete_user_memory_item', true, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'delete_user_memory_item');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	const id = String(item_id || '').trim();
	if(!id){
		return {ok: false, error: 'item_id_required'};
	}

	const current = await getUserMemoryPrivate(ctx);
	if(current.enabled !== true){
		return {ok: false, error: current.reason || 'memory_unavailable'};
	}

	const {data} = ensureMemoryItemIds(current.data || defaultMemoryData());
	const before = data.items.length;
	data.items = data.items.filter(item => item?.id !== id);
	if(data.items.length === before){
		return {ok: false, error: 'memory_item_not_found'};
	}

	data.updated_at = new Date().toISOString();
	await upsertUserMemoryRow(identity.chat_id, identity.user_id, data);
	return {ok: true, deleted: true, item_count: data.items.length};
}

export async function patchUserCharacteristics(ctx, args){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, 'patch_user_characteristics', false, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'patch_user_characteristics');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	if(args?.chat_id || args?.user_id){
		logger.warn(`patchUserCharacteristics: явный chat_id/user_id запрещён. chat_id=${args?.chat_id}; user_id=${args?.user_id}`).then();
		return {ok: false, error: 'explicit_identity_forbidden'};
	}

	const patch = isPlainObject(args?.patch) ? args.patch : null;
	if(!patch || Object.keys(patch).length === 0){
		return {ok: false, error: 'empty_patch'};
	}

	if(hasLikelySecret(json2string(patch))){
		return {ok: false, error: 'secret_like_data'};
	}

	const current = await getUserCharacteristicsForUpdate(ctx);
	if(current.enabled !== true){
		return {ok: false, error: current.reason || 'characteristics_unavailable'};
	}

	let profile;
	try{
		profile = deepMerge(current.data?.profile || {}, patch, getCharacteristicsMergeOptions());
	}catch(err){
		logger.warn(err).then();
		return {ok: false, error: 'invalid_patch'};
	}

	const data = current.data || defaultCharacteristicsData();
	data.profile = profile;
	data.observations = Array.isArray(data.observations) ? data.observations : [];
	data.observations.push({
		evidence: String(args?.evidence || '').slice(0, 1000),
		confidence: Number.isFinite(Number(args?.confidence)) ? Math.max(0, Math.min(1, Number(args.confidence))) : 0.6,
		updated_at: new Date().toISOString()
	});
	data.updated_at = new Date().toISOString();

	await upsertUserCharacteristicsRow(identity.chat_id, identity.user_id, data);
	return {ok: true, patched: true};
}

export async function recalculateUserCharacteristics(ctx, args){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, 'recalculate_user_characteristics', false, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'recalculate_user_characteristics');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	if(args?.chat_id || args?.user_id){
		logger.warn(`recalculateUserCharacteristics: явный chat_id/user_id запрещён. chat_id=${args?.chat_id}; user_id=${args?.user_id}`).then();
		return {ok: false, error: 'explicit_identity_forbidden'};
	}

	const profile = isPlainObject(args?.profile) ? args.profile : null;
	if(!profile || Object.keys(profile).length === 0){
		return {ok: false, error: 'empty_profile'};
	}

	if(hasLikelySecret(json2string(profile))){
		return {ok: false, error: 'secret_like_data'};
	}

	let safe_profile;
	try{
		safe_profile = deepMerge({}, profile, getCharacteristicsMergeOptions());
	}catch(err){
		logger.warn(err).then();
		return {ok: false, error: 'invalid_profile'};
	}

	const observations = Array.isArray(args?.observations) ? args.observations.slice(0, 50) : [];
	const data = {
		profile: safe_profile,
		observations: observations.map(observation => ({
			evidence: String(observation?.evidence || '').slice(0, 1000),
			confidence: Number.isFinite(Number(observation?.confidence)) ? Math.max(0, Math.min(1, Number(observation.confidence))) : 0.6,
			updated_at: new Date().toISOString()
		})),
		updated_at: new Date().toISOString()
	};

	await upsertUserCharacteristicsRow(identity.chat_id, identity.user_id, data);
	return {ok: true, recalculated: true};
}

export async function deleteUserMemory(ctx){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_MEMORY, 'delete_user_memory', true, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'delete_user_memory');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	await upsertUserMemoryRow(identity.chat_id, identity.user_id, defaultMemoryData());
	return {ok: true, deleted: true};
}

export async function deleteUserCharacteristics(ctx){
	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, 'delete_user_characteristics', true, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'delete_user_characteristics');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	await upsertUserCharacteristicsRow(identity.chat_id, identity.user_id, defaultCharacteristicsData());
	return {ok: true, deleted: true};
}

export async function queueUserCharacteristicsRecalc(ctx, args = {}, bInternal = false){
	if(bInternal !== true){
		const identity = telegram.getContextIdentity(ctx, false);
		logger.warn(`Прямой вызов queueUserCharacteristicsRecalc заблокирован. chat_id=${identity?.chat_id}; user_id=${identity?.user_id}`).then();
		return {ok: false, error: 'direct_call_forbidden'};
	}

	const access = await checkPrivateContextAccess(ctx, memory_config.CONTEXT_TYPE_CHARACTERISTICS, 'queue_user_characteristics_recalc', false, true);
	if(access.enabled !== true){
		return {ok: false, error: access.reason};
	}

	const identity = getAccessIdentity(access, 'queue_user_characteristics_recalc');
	if(!identity){
		return {ok: false, error: 'invalid_identity'};
	}

	const priority = Number.parseInt(args?.priority || '100', 10);
	await db.query(
		`INSERT INTO USER_MEMORY_RECALC_QUEUE (CHAT_ID, USER_ID, KIND, REASON, PRIORITY, NOT_BEFORE, UPDATED_AT)
         VALUES ($1::BIGINT, $2::BIGINT, 'characteristics', $3::TEXT, $4::INT, NOW(), NOW())
         ON CONFLICT (CHAT_ID, USER_ID, KIND)
             DO UPDATE SET REASON = EXCLUDED.REASON,
                           PRIORITY = LEAST(USER_MEMORY_RECALC_QUEUE.PRIORITY, EXCLUDED.PRIORITY),
                           NOT_BEFORE = LEAST(USER_MEMORY_RECALC_QUEUE.NOT_BEFORE, EXCLUDED.NOT_BEFORE),
                           UPDATED_AT = NOW();`,
		[identity.chat_id, identity.user_id, String(args?.reason || 'ai_dialog'), Number.isFinite(priority) ? priority : 100]
	);
	return {ok: true, queued: true};
}

export async function getPrivateContextMessages(ctx){
	const identity = telegram.getContextIdentity(ctx, false);
	if(!identity || !telegram.checkPrivateChat(identity, 'get_private_context_messages', false)){
		return [];
	}

	const [memory, characteristics] = await Promise.all([
		getUserMemoryPrivate(ctx),
		getUserCharacteristicsPrivate(ctx)
	]);

	if(memory.enabled !== true && characteristics.enabled !== true){
		return [];
	}

	const payload = {
		context_type: 'encrypted_private_context',
		scope: 'current Telegram CHAT_ID + USER_ID only',
		allowed_use: 'background_context_for_answer_preparation_only',
		forbidden_use: 'explicit_output_quote_list_summary_reveal_or_mention'
	};
	if(memory.enabled === true){
		payload.memory = memory.data;
	}
	if(characteristics.enabled === true){
		payload.characteristics = characteristics.data;
	}

	const payload_text = json2string(payload).slice(0, memory_config.AI_MEMORY_MAX_PROMPT_CHARS);
	if(!payload_text || payload_text === '{}'){
		return [];
	}

	return [{
		role: 'system',
		content: [
			'PRIVATE_CONTEXT_JSON follows.',
			'This is encrypted-at-rest private context for the current Telegram chat-user pair only.',
			'Use it strictly as background context for preparing the answer.',
			'Do not quote, list, summarize, reveal, mention or explicitly output stored memory or characteristics in any AI answer.',
			'Only dedicated private-chat bot commands may display, edit, delete or export these stored values.',
			'',
			payload_text
		].join('\n'),
		private_context: true,
		private_context_type: 'user_memory'
	}];
}
