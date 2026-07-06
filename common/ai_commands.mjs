import * as logger      from './logger.mjs';
import * as telegram    from './telegram.mjs';
import * as telegram_db from "./telegram_db.mjs";
import * as deepseek    from './deepseek.mjs';

const AI_BOOLEAN_SETTINGS_TYPES = new Set([
	'USER_MEMORY_ENABLED',
	'USER_CHARACTERISTICS_ENABLED'
]);
const AI_SETTINGS_TYPES         = new Set([
	'SYSTEM_PROMPT',
	'SUMMARY_PROMPT',
	'TEST_SPAM_PROMPT',
	'TEMPERATURE',
	'MESSAGE_LIMIT',
	'USER_MEMORY_ENABLED',
	'USER_CHARACTERISTICS_ENABLED'
]);
const AI_MEMORY_SETTINGS_TYPES  = new Set([
	'USER_MEMORY_ENABLED',
	'USER_CHARACTERISTICS_ENABLED'
]);


/**
 * Гарантирует наличие базовых записей чата/пользователя перед работой с AI2CHAT_SETTINGS.
 * Особенно важно для первой команды в private-чате.
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
async function ensureAISettingsContext(ctx){
	const chat = telegram.getChatFromCtx(ctx);
	const user = telegram.getUserFromCtx(ctx);
	if(!chat?.id){
		logger.warn('Не удалось определить чат для AI-настроек.').then();
		return false;
	}

	const tasks = [telegram_db.addChat2DB(chat)];
	if(user?.id){
		tasks.push(telegram_db.addUser2DB(user));
	}

	await Promise.all(tasks).catch(err => logger.err(err).then());
	return true;
}

/**
 * Проверка доступа к управлению AI-настройками текущего чата.
 * В private-чате admin-check не требуется, в группе требуется админ.
 * @param {CTX} ctx
 * @param {String} command
 * @returns {Promise<Boolean>}
 */
async function requireAISettingsAccess(ctx, command){
	const chat = telegram.getChatFromCtx(ctx);
	if(!await ensureAISettingsContext(ctx)){
		return false;
	}

	if(chat?.type === 'private'){
		return true;
	}

	const bAllowed = await telegram.requireChatAdmin(ctx);
	if(!bAllowed){
		logger.info(`Команда \`${command}\` не от админа чата`).then();
	}
	return bAllowed;
}

/**
 * Нормализация значения AI-настройки.
 * @param {String} type
 * @param {String} value
 * @returns {?String}
 */
function normalizeAISettingValue(type, value){
	const text = String(value ?? '').trim();
	if(AI_BOOLEAN_SETTINGS_TYPES.has(type)){
		const normalized = text.toLowerCase();
		if(normalized === 'true' || normalized === 'false'){
			return normalized;
		}
		return null;
	}

	return text;
}

/**
 * Формат справки по команде set_ai_settings.
 * @returns {String}
 */
function getSetAISettingsUsage(){
	return `Неверная команда.
Требуется формат:

\`/set_ai_settings MODE NAME VALUE\`

Примеры:
\`/set_ai_settings false SYSTEM_PROMPT Текст системного промпта\`
\`/set_ai_settings true TEMPERATURE 1.2\`
\`/set_ai_settings false USER_MEMORY_ENABLED true\`
\`/set_ai_settings false USER_CHARACTERISTICS_ENABLED false\`

Для USER_MEMORY_ENABLED и USER_CHARACTERISTICS_ENABLED значение должно быть только true/false. Режим MODE для этих настроек принудительно считается false, так как память читается из обычного режима чата.`;
}


/**
 * Регистрация команд управления памятью и характеристиками пользователя.
 * Явный вывод/редактирование/удаление разрешены только в личном чате.
 * @param {*} bot
 * @returns {void}
 */
export function registerAICommands(bot){
	bot?.command('deepseek_test_spam', async(ctx) => {
		let res;

		/** @type {Message|Edited_Message} */ const message = telegram.getCtxMessage(ctx);
		if(message && message.message_id && message?.text){
			const answer = await deepseek.testMessage(ctx);

			res = telegram.replyMessage(ctx,
				message.message_id,
				answer || 'NOT_ANSWER',
				false);
		}

		// telegram.deleteMessage(ctx).then(); // Удаляем командное сообщение
		return res;
	});

	bot?.command('deepseek', async(ctx) => {
		const res = deepseek.deepSeekTalks(ctx);

		// telegram.deleteMessage(ctx).then(); // Удаляем командное сообщение
		return res;
	});

	bot?.command('deepseek_analyse', async(ctx) => {
		const res = deepseek.deepSeekTalks(ctx, true);

		// telegram.deleteMessage(ctx).then(); // Удаляем командное сообщение
		return res;
	});

	bot?.command('deepseek_summary', async(ctx) => {
		const res = deepseek.deepSeekSummary(ctx);

		// telegram.deleteMessage(ctx).then(); // Удаляем командное сообщение
		return res;
	});

	bot?.command('get_ai_settings', async(ctx) => {
		if(await requireAISettingsAccess(ctx, 'get_ai_settings')){
			telegram.sendAutoRemoveMsg(ctx, 'Текущие настройки АИ для чата:').then();
			telegram.sendAutoRemoveMsg(ctx, 'Режим чата:').then();
			let settings = (await telegram_db.getChatAISettings(ctx, deepseek.AI_ID, false))?.rows;
			for(let i = 0; i < settings?.length; i++){
				const setting = settings[i];
				telegram.sendAutoRemoveMsg(ctx, `${setting.type}: ${'`' + setting.value + '`'}`).then();
			}
			telegram.sendAutoRemoveMsg(ctx, `Режим аналитики:`).then();
			settings = (await telegram_db.getChatAISettings(ctx, deepseek.AI_ID, true))?.rows;
			for(let i = 0; i < settings?.length; i++){
				const setting = settings[i];
				telegram.sendAutoRemoveMsg(ctx, `${setting.type}: ${'`' + setting.value + '`'}`).then();
			}
		}

		// telegram.deleteMessage(ctx).then(); // Удаляем командное сообщение
	});

	bot?.command('set_ai_settings', async(ctx) => {
		if(await requireAISettingsAccess(ctx, 'set_ai_settings')){
			// Очистка текста от самой команды
			const message = telegram.getCtxMessage(ctx);
			const msg     = message.text.replace(/^\/set_ai_settings(?:@\w+)?\s*/igm, '').trim();

			// Парсим командный текст по образцу
			// MODE TYPE VALUE
			const arr = (/^(true|false)\s+(SYSTEM_PROMPT|SUMMARY_PROMPT|TEST_SPAM_PROMPT|TEMPERATURE|MESSAGE_LIMIT|USER_MEMORY_ENABLED|USER_CHARACTERISTICS_ENABLED)\s+([\s\S]*)/igm).exec(msg.replace(/\n/igm, '\\n'));
			if(arr?.length >= 4 && arr[1] && arr[2] && arr[3]){
				const type        = arr[2]?.toUpperCase().trim();
				let reasoner_mode = arr[1]?.toLowerCase() === 'true';
				const value       = normalizeAISettingValue(type, arr[3]);

				if(!AI_SETTINGS_TYPES.has(type) || value == null || value === ''){
					return telegram.sendAutoRemoveMsg(ctx, getSetAISettingsUsage(), true);
				}

				if(AI_MEMORY_SETTINGS_TYPES.has(type)){
					reasoner_mode = false;
				}

				try{
					await telegram_db.setChatAISettings(ctx, deepseek.AI_ID, reasoner_mode, type, value);
					return telegram.sendAutoRemoveMsg(ctx, 'Параметр сохранён.');

				}catch(err){
					logger.err(err).then();
					return telegram.sendAutoRemoveMsg(ctx, 'Ошибка при сохранении параметра.\nПроверьте логи на сервере для подробностей');
				}

			}else{
				return telegram.sendAutoRemoveMsg(ctx, getSetAISettingsUsage(), true);
			}
		}

		// telegram.deleteMessage(ctx).then(); // Удаляем команду
	});
}
