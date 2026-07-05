/* jshint -W083 */

import MarkdownIt from 'markdown-it';

const TELEGRAM_MAX_MESSAGE_LENGTH = parseInt(process.env.TELEGRAM_MAX_MESSAGE_LENGTH, 10) || 4000;
const TELEGRAM_TABLE_MAX_CELL_WIDTH = Math.max(12, Math.min(parseInt(process.env.TELEGRAM_TABLE_MAX_CELL_WIDTH, 10) || 32, 80));
const TELEGRAM_TABLE_MAX_WIDTH = Math.max(40, Math.min(parseInt(process.env.TELEGRAM_TABLE_MAX_WIDTH, 10) || 100, 180));
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()\[\]{}"']+/gim;

//--------------------------------------------

function rangesOverlap(aStart, aEnd, bStart, bEnd){
	return aStart < bEnd && bStart < aEnd;
}

function isEntityRangeCovered(entities, start, end){
	return entities.some(entity => rangesOverlap(start, end, entity.offset, entity.offset + entity.length));
}

function normalizeUrlLength(rawUrl){
	let length = rawUrl.length;
	while(length > 0 && /[.,!?;:)>}\]»”]$/u.test(rawUrl.substring(0, length))){
		length--;
	}
	return length;
}

function normalizeEntities(message, entities = []){
	const normalized = entities
		.filter(entity => {
			return (
				entity &&
				Number.isInteger(entity.offset) &&
				Number.isInteger(entity.length) &&
				entity.offset >= 0 &&
				entity.length > 0 &&
				entity.offset < message.length &&
				entity.offset + entity.length <= message.length
			);
		});

	const result = [...normalized];
	let match;
	URL_RE.lastIndex = 0;
	while((match = URL_RE.exec(message)) !== null){
		const rawUrl = match[0];
		const length = normalizeUrlLength(rawUrl);
		if(length <= 0){
			continue;
		}

		const offset = match.index;
		const end = offset + length;
		if(isEntityRangeCovered(result, offset, end)){
			continue;
		}

		result.push({type: 'url', offset, length});
	}

	return result.sort((a, b) => a.offset - b.offset || b.length - a.length);
}

function splitPlainMessage(message){
	const result = [];
	message = String(message ?? '');

	while(message.length > 0){
		const part = message.substring(0, TELEGRAM_MAX_MESSAGE_LENGTH);
		result.push({
			message: part,
			entities: normalizeEntities(part, []),
			images: []
		});
		message = message.substring(TELEGRAM_MAX_MESSAGE_LENGTH);
	}

	return result;
}

function parseMarkdown(message){
	const md = MarkdownIt();
	const env = {references: {}};
	return md.parse(String(message ?? ''), env);
}

function normalizeTableCell(text){
	return String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
}

function inlineTokenToText(token){
	if(!token){
		return '';
	}

	if(Array.isArray(token.children) && token.children.length > 0){
		return token.children.map(inlineTokenToText).join('');
	}

	switch(token.type){
		case 'text':
		case 'code_inline':
			return token.content || '';

		case 'softbreak':
		case 'hardbreak':
			return ' ';

		case 'image':
			return token.content || token.attrs?.find(attr => attr?.[0] === 'alt')?.[1] || '';

		default:
			return token.content || '';
	}
}

function tableWidth(widths){
	return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 3;
}

function shrinkTableWidths(widths){
	widths = [...widths];
	while(tableWidth(widths) > TELEGRAM_TABLE_MAX_WIDTH){
		let maxIndex = -1;
		let maxWidth = 0;
		for(let i = 0; i < widths.length; i++){
			if(widths[i] > maxWidth){
				maxWidth = widths[i];
				maxIndex = i;
			}
		}

		if(maxIndex < 0 || maxWidth <= 12){
			break;
		}

		widths[maxIndex]--;
	}
	return widths;
}

function wrapTableCell(cell, width){
	cell = normalizeTableCell(cell);
	if(!cell){
		return [''];
	}

	const result = [];
	let line = '';

	for(const word of cell.split(/\s+/)){
		let rest = word;
		while(rest.length > width){
			if(line){
				result.push(line);
				line = '';
			}
			result.push(rest.substring(0, width));
			rest = rest.substring(width);
		}

		if(!rest){
			continue;
		}

		const candidate = line ? `${line} ${rest}` : rest;
		if(candidate.length <= width){
			line = candidate;
		}else{
			if(line){
				result.push(line);
			}
			line = rest;
		}
	}

	if(line){
		result.push(line);
	}

	return result.length > 0 ? result : [''];
}

function padRight(text, width){
	text = String(text ?? '');
	return text + ' '.repeat(Math.max(0, width - text.length));
}

function renderTableRow(row, widths){
	const wrapped = widths.map((width, index) => wrapTableCell(row[index] ?? '', width));
	const maxLines = Math.max(1, ...wrapped.map(lines => lines.length));
	const result = [];

	for(let lineIndex = 0; lineIndex < maxLines; lineIndex++){
		result.push(wrapped.map((lines, index) => padRight(lines[lineIndex] ?? '', widths[index])).join(' | ').trimEnd());
	}

	return result;
}

function renderMarkdownTable(rows){
	rows = rows
		.map(row => row.map(normalizeTableCell))
		.filter(row => row.some(cell => cell.length > 0));

	if(rows.length === 0){
		return '';
	}

	const columnCount = Math.max(...rows.map(row => row.length));
	if(columnCount <= 0){
		return '';
	}

	rows = rows.map(row => {
		const normalized = [...row];
		while(normalized.length < columnCount){
			normalized.push('');
		}
		return normalized;
	});

	let widths = Array.from({length: columnCount}, (_, columnIndex) => {
		const maxCell = Math.max(...rows.map(row => normalizeTableCell(row[columnIndex]).length));
		return Math.max(3, Math.min(maxCell, TELEGRAM_TABLE_MAX_CELL_WIDTH));
	});
	widths = shrinkTableWidths(widths);

	const lines = [];
	rows.forEach((row, rowIndex) => {
		lines.push(...renderTableRow(row, widths));
		if(rowIndex === 0 && rows.length > 1){
			lines.push(widths.map(width => '-'.repeat(width)).join('-+-'));
		}
	});

	return lines.join('\n');
}

/**
 * Парсинг и отправка сообщения по частям, в связи с ограничением API Telegram
 * @param {String}  message
 * @returns {[{message: String, entities: [{type: String, offset: Number, length: Number, language?: String, url?: String}], images?:[{}] }]}
 */
export const parseMessageAndSaveByParts = (message) => {
	const result = [];

	let parsed_message;
	try{
		parsed_message = parseMarkdown(message);
	}catch(err){
		console.warn(err);
		return splitPlainMessage(message);
	}

	let _message   = '';
	let prefix     = '';
	let line_break = '';
	let bList      = false;
	let bTable     = false;
	let tableRows = [];
	let tableRow = null;
	let tableCell = null;
	let entities   = [];
	let images     = [];

	let blockquote_open = [];
	for(let i = 0; i < parsed_message.length; i++){
		const el        = parsed_message[i];
		let new_message = '';
		let _entities   = [];
		let _images     = [];

		switch(el?.type){
			// Добавляем перевод строки
			case 'paragraph_open':  //Игнорируем
			case 'bullet_list_open':
			case 'list_item_close':
			case 'ordered_list_open':
				break;

			case 'table_open':
				bTable = true;
				tableRows = [];
				tableRow = null;
				tableCell = null;
				break;

			case 'table_close':
				bTable = false;
				{
					const tableText = renderMarkdownTable(tableRows);
					if(tableText){
						new_message = line_break + prefix;
						const tableOffset = new_message.length;
						new_message += tableText;
						_entities.push({type: 'pre', offset: tableOffset, length: tableText.length});
						line_break = '\n';
						prefix = '';
					}
				}
				tableRows = [];
				tableRow = null;
				tableCell = null;
				break;

			case 'thead_open':
			case 'thead_close':
			case 'tbody_open':
			case 'tbody_close':
				break;

			case 'tr_open':
				if(bTable){
					tableRow = [];
				}
				break;

			case 'tr_close':
				if(bTable && tableRow?.length){
					tableRows.push(tableRow);
				}
				tableRow = null;
				break;

			case 'th_open':
			case 'td_open':
				if(bTable){
					tableCell = '';
				}
				break;

			case 'th_close':
			case 'td_close':
				if(bTable && tableRow){
					tableRow.push(tableCell ?? '');
				}
				tableCell = null;
				break;

			case 'paragraph_close':
			case 'heading_close':
				line_break += bList ? '' : '\n';
				bList = false;
				break;

			case 'bullet_list_close':
			case 'ordered_list_close':
				line_break += '\n';
				bList = false;
				break;

			// Добавляем признак заголовка как префикс. Этот признак надо учитывать только с последующим текстом заголовка
			case 'heading_open':
				prefix += el.markup + ' ';
				break;

			// Добавляем блок кода
			case 'fence':
				_entities.push({
					type:     'pre',
					offset:   new_message.length,
					length:   el.content.length,
					language: el.info
				});
				new_message += el.content;
				break;

			// Добавляем блок кода
			case 'list_item_open':
				prefix += line_break + '\n' + prefix + el.info + el.markup + ' ';
				line_break = '';
				bList      = true;
				break;

			case 'hr':
				new_message += line_break + '\n' + prefix + el.markup + '\n';
				line_break = '';
				prefix     = '';
				break;

			// Общий текст. Надо учесть предыдущий перевод строки и префиксы
			case 'inline':
				if(bTable){
					tableCell = `${tableCell ?? ''}${inlineTokenToText(el)}`;
					break;
				}

				if(el.children && el.children.length){
					let _new_message = '';
					const __entities = [];
					const __images   = [];

					const strong_open    = [];
					const italic_open    = [];
					const underline_open = [];
					const stroke_open    = [];
					const link_open      = [];

					let i;

					for(let j = 0; j < el.children.length; j++){
						const el_ch = el.children[j];
						switch(el_ch.type){
							case 'text':
								_new_message += el_ch.content;
								break;

							case 'code_inline':
								__entities.push({
									type:   'code',
									offset: _new_message.length,
									length: el_ch.content.length
								});
								_new_message += el_ch.content;
								break;

							case 'softbreak':
							case 'hardbreak':
								_new_message += '\n';
								break;

							case 'strong_open':
								strong_open.push(_new_message.length);
								break;

							case 'strong_close':
								if(strong_open.length){
									i = strong_open.pop();
									if(_new_message.length > i){
										__entities.push({type: 'bold', offset: i, length: _new_message.length - i});
									}
								}
								break;

							case 'em_open':
								italic_open.push(_new_message.length);
								break;

							case 'em_close':
								if(italic_open.length){
									i = italic_open.pop();
									if(_new_message.length > i){
										__entities.push({type: 'italic', offset: i, length: _new_message.length - i});
									}
								}
								break;

							case 's_open':
								stroke_open.push(_new_message.length);
								break;

							case 's_close':
								if(stroke_open.length){
									i = stroke_open.pop();
									if(_new_message.length > i){
										__entities.push({type: 'strikethrough', offset: i, length: _new_message.length - i});
									}
								}
								break;

							case 'underline_open':
								underline_open.push(_new_message.length);
								break;

							case 'underline_close':
								if(underline_open.length){
									i = underline_open.pop();
									if(_new_message.length > i){
										__entities.push({type: 'underline', offset: i, length: _new_message.length - i});
									}
								}
								break;

							case 'link_open':
								link_open.push({i: _new_message.length, url: el_ch.attrs[0][1]});
								break;

							case 'link_close':
								if(link_open.length){
									i = link_open.pop() || {i: 0, url: ''};
									if(_new_message.length > i){
										__entities.push({type: 'text_link', offset: i.i, length: _new_message.length - i.i, url: i.url});
									}
								}
								break;

							case 'image':
								const alt = el_ch.attrs[1][1] || 'Изображение ' + (_images.length + __images.length + 1);
								__entities.push({
									type:   'text_link',
									offset: _new_message.length,
									length: alt.length,
									url:    el_ch.attrs[0][1]
								});
								_new_message += alt;
								__images.push({src: el_ch.attrs[0][1], alt: alt});
								break;

							default:
								console.warn(el_ch.type);
								console.dir(el_ch);

								_new_message += el_ch?.content || '';

								break;
						}
					}

					// Завершаем всё открытые, но по какой-либо причине, не закрытые блоки оформления
					strong_open.forEach(i => __entities.push({type: 'bold', offset: i, length: _new_message.length - i}));
					italic_open.forEach(i => __entities.push({type: 'italic', offset: i, length: _new_message.length - i}));
					stroke_open.forEach(i => __entities.push({type: 'strikethrough', offset: i, length: _new_message.length - i}));
					underline_open.forEach(i => __entities.push({type: 'underline', offset: i, length: _new_message.length - i}));
					link_open.forEach(i => __entities.push({type: 'text_link', offset: i.i, length: _new_message.length - i.i, url: i.url}));

					new_message = line_break + prefix;
					_entities   = _entities.concat(__entities.map(el => {
						el.offset += new_message.length;
						return el;
					}));
					new_message += _new_message;
					_images     = _images.concat(__images);

				}else{
					new_message += line_break + prefix + el.content;
				}

				prefix     = '';
				line_break = '';
				break;

			case 'code_block':
				if(el.content){
					_entities.push({
						type:   'pre',
						offset: new_message.length,
						length: el.content.length
					});
					new_message += el.content;
				}
				break;

			case 'blockquote_open':
				blockquote_open.push(_message.length);
				break;

			case 'blockquote_close':
				const i = blockquote_open.pop() || 0;
				_entities.push({type: 'blockquote', offset: i, length: _message.length - i});
				break;


			default:
				console.warn(el.type);
				console.dir(el);

				new_message += el.content || '';

				break;
		}

		if((_message + new_message).length > TELEGRAM_MAX_MESSAGE_LENGTH){
			// Превышение размера.
			// Отправляем часть сообщения и начинаем формировать новую строку для отправки

			if(blockquote_open.length > 0){ // Есть незакрытая цитата. Закрываем текущий отправляемый блок и переносит блок цитаты, с корректировкой, на следующее сообщение
				blockquote_open.forEach(i => entities.push({type: 'blockquote', offset: (i || 0), length: _message.length - (i || 0)}));

				// в новом куске цитата продолжается с начала сообщения
				blockquote_open = [0];
			}

			result.push({message: _message, entities: normalizeEntities(_message, entities), images: images});

			_message = new_message;     // Запоминаем неотправленную часть как новый аккумулятор
			entities = _entities;       // Запоминаем неотправленное оформление
			images   = _images;           // Запоминаем неотправленные изображения

		}else{  // Размер не превышен. Наращиваем строку для отправки и объединяем оформление с правильным смещением
			entities = entities.concat(_entities.map(el => {
				if(el.type !== 'blockquote'){
					el.offset += _message.length;
				}
				return el;
			}));
			images   = images.concat(_images);
			_message += new_message;
		}

	}

	if(_message.length > 0){
		result.push({
			message: _message,
			entities: normalizeEntities(_message, entities),
			images: images
		});
	}

	return result.length > 0 ? result : splitPlainMessage(message);
};
