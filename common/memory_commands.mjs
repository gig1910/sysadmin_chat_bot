import {Markup} from 'telegraf';

import * as logger    from './logger.mjs';
import * as telegram  from './telegram.mjs';
import * as tg_db     from './telegram_db.mjs';
import * as memory_db from './memory_db.mjs';
import {json2string}  from './utils.mjs';
import * as ai_memory_tools from "./ai_memory_tools.mjs";

/**
 * Гарантирует наличие текущих CHAT/USER перед операциями с приватной памятью.
 * @param {CTX} ctx
 * @returns {Promise<Boolean>}
 */
async function ensurePrivateCommandContext(ctx){
	const chat = telegram.getChatFromCtx(ctx);
	const user = telegram.getUserFromCtx(ctx);
	if(!chat?.id || !user?.id){
		logger.warn('Не удалось определить chat/user для команды управления памятью.').then();
		return false;
	}

	await Promise.all([
		tg_db.addChat2DB(chat),
		tg_db.addUser2DB(user)
	]).catch(err => logger.err(err).then());

	return true;
}

/**
 * Проверка, что команда управления приватными данными вызвана в личном чате.
 * @param {CTX} ctx
 * @param {String} command
 * @returns {Promise<Boolean>}
 */
async function requirePrivateBotCommand(ctx, command){
	const chat = telegram.getChatFromCtx(ctx);
	if(chat?.type !== 'private'){
		await telegram.sendAutoRemoveMsg(ctx, `Команда ${command} доступна только в личном чате с ботом.`, false, 15000);
		return false;
	}

	return ensurePrivateCommandContext(ctx);
}

/**
 * Короткое отображение записи памяти для пользовательского управления.
 * @param {Object} item
 * @param {Number} index
 * @returns {String}
 */
function formatMemoryItemForManager(item, index){
	const text = String(item?.text || '').trim() || '[без текста]';
	const type = String(item?.type || 'memory');
	return [
		`#${index + 1} ${type}`,
		`ID: ${item?.id}`,
		'',
		text.slice(0, 1200)
	].join('\n');
}

/**
 * Отправка списка записей памяти с кнопками управления.
 * @param {CTX} ctx
 * @returns {Promise<void>}
 */
async function sendMemoryManager(ctx){
	if(!await requirePrivateBotCommand(ctx, '/memory')){
		return;
	}

	const res = await memory_db.listUserMemoryItemsPrivate(ctx);
	if(res.ok !== true){
		await telegram.sendAutoRemoveMsg(ctx, `Память недоступна: ${res.error || 'unknown_error'}`, false, 15000);
		return;
	}

	if(!res.items?.length){
		await telegram.sendMessage(ctx, 'Память пуста.', false);
		return;
	}

	await telegram.sendMessage(ctx, 'Записи памяти. Просмотр, редактирование и удаление доступны только в личном чате.', false);
	for(let i = 0; i < res.items.length; i++){
		const item = res.items[i];
		await ctx.reply(
			formatMemoryItemForManager(item, i),
			Markup.inlineKeyboard([[
				Markup.button.callback('✏️ Изменить', `memory_edit:${item.id}`),
				Markup.button.callback('🗑 Удалить', `memory_delete:${item.id}`)
			]])
		);
	}
}

/**
 * Регистрация команд управления памятью и характеристиками пользователя.
 * Явный вывод/редактирование/удаление разрешены только в личном чате.
 * @param {*} bot
 * @returns {void}
 */
export function registerMemoryCommands(bot){

	if(ai_memory_tools.isUserMemoryDataEnabled()){
		bot?.command('memory', async(ctx) => sendMemoryManager(ctx));

		bot?.command('memory_edit', async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, '/memory_edit')){
				return;
			}

			const message = telegram.getCtxMessage(ctx);
			const msg     = message?.text?.replace(/^\/memory_edit(?:@\w+)?\s*/igm, '').trim() || '';
			const arr     = /^([^\s]+)\s+([\s\S]+)$/im.exec(msg);
			if(!arr){
				return telegram.sendMessage(ctx, 'Формат: /memory_edit MEMORY_ID новый текст записи', false);
			}

			const res = await memory_db.updateUserMemoryItemPrivate(ctx, arr[1], {text: arr[2]});
			if(res.ok === true){
				return telegram.sendMessage(ctx, 'Запись памяти обновлена.', false);
			}
			return telegram.sendMessage(ctx, `Не удалось обновить запись памяти: ${res.error || 'unknown_error'}`, false);
		});

		bot?.command('memory_delete', async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, '/memory_delete')){
				return;
			}

			const message = telegram.getCtxMessage(ctx);
			const item_id = message?.text?.replace(/^\/memory_delete(?:@\w+)?\s*/igm, '').trim();
			if(!item_id){
				return telegram.sendMessage(ctx, 'Формат: /memory_delete MEMORY_ID', false);
			}

			const res = await memory_db.deleteUserMemoryItemPrivate(ctx, item_id);
			if(res.ok === true){
				return telegram.sendMessage(ctx, 'Запись памяти удалена.', false);
			}
			return telegram.sendMessage(ctx, `Не удалось удалить запись памяти: ${res.error || 'unknown_error'}`, false);
		});

		bot?.command('memory_forget', async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, '/memory_forget')){
				return;
			}

			const res = await memory_db.deleteUserMemory(ctx);
			return telegram.sendMessage(ctx, res.ok === true ? 'Память очищена.' : `Не удалось очистить память: ${res.error || 'unknown_error'}`, false);
		});

		bot?.command('characteristics', async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, '/characteristics')){
				return;
			}

			const res = await memory_db.getUserCharacteristicsPrivate(ctx);
			if(res.enabled !== true){
				return telegram.sendMessage(ctx, `Характеристики недоступны: ${res.reason || 'unknown_error'}`, false);
			}
			return telegram.sendMessage(ctx, json2string(res.data, 2) || '{}', false);
		});

		bot?.command('characteristics_reset', async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, '/characteristics_reset')){
				return;
			}

			const res = await memory_db.deleteUserCharacteristics(ctx);
			return telegram.sendMessage(ctx, res.ok === true ? 'Характеристики очищены.' : `Не удалось очистить характеристики: ${res.error || 'unknown_error'}`, false);
		});

		bot?.action(/memory_edit:(.+)/, async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, 'memory_edit')){
				return ctx.answerCbQuery('Только личный чат.');
			}

			const item_id = ctx.match?.[1];
			await ctx.answerCbQuery('Отправьте команду /memory_edit');
			return telegram.sendMessage(ctx, `Для изменения записи отправьте:\n/memory_edit ${item_id} новый текст записи`, false);
		});

		bot?.action(/memory_delete:(.+)/, async(ctx) => {
			if(!await requirePrivateBotCommand(ctx, 'memory_delete')){
				return ctx.answerCbQuery('Только личный чат.');
			}

			const item_id = ctx.match?.[1];
			const res     = await memory_db.deleteUserMemoryItemPrivate(ctx, item_id);
			await ctx.answerCbQuery(res.ok === true ? 'Удалено.' : 'Ошибка удаления.');
			if(res.ok === true){
				return ctx.editMessageText('Запись памяти удалена.');
			}
			return telegram.sendMessage(ctx, `Не удалось удалить запись памяти: ${res.error || 'unknown_error'}`, false);
		});
	}
}
