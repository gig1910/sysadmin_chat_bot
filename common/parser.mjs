/* jshint -W083 */

import MarkdownIt from 'markdown-it';

const TELEGRAM_MAX_MESSAGE_LENGTH = parseInt(process.env.TELEGRAM_MAX_MESSAGES_LENGTH, 10) || 4000;

//--------------------------------------------

/**
 * Парсинг и отправка сообщения по частям, в связи с ограничением API Telegram
 * @param {String}  message
 * @returns {[{message: String, entities: [{type: String, offset: Number, length: Number, language?: String, url?: String}], images?:[{}] }]}
 */
export const parseMessageAndSaveByParts = (message) => {
	const result = [];
	
	const md = MarkdownIt();
	
	const parsed_message = md.parse(message);
	
	let _message = '';
	let prefix = '';
	let line_break = '';
	let bList = false;
	let entities = [];
	let images = [];
	
	let blockquote_open = [];
	for(let i = 0; i < parsed_message.length; i++){
		const el = parsed_message[i];
		let new_message = '';
		let _entities = [];
		let _images = [];
		
		switch(el?.type){
			// Добавляем перевод строки
			case 'paragraph_open':  //Игнорируем
			case 'bullet_list_open':
			case 'list_item_close':
			case 'ordered_list_open':
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
				bList = true;
				break;
			
			case 'hr':
				new_message += line_break + '\n' + prefix + el.markup + '\n';
				line_break = '';
				prefix = '';
				break;
			
			// Общий текст. Надо учесть предыдущий перевод строки и префиксы
			case 'inline':
				if(el.children && el.children.length){
					let _new_message = '';
					const __entities = [];
					const __images = [];
					
					const strong_open = [];
					const italic_open = [];
					const underline_open = [];
					const stroke_open = [];
					const link_open = [];
					
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
								_new_message += '\n';
								break;
							
							case 'strong_open':
								strong_open.push(_new_message.length);
								break;
							
							case 'strong_close':
								i = strong_open.pop() || 0;
								__entities.push({type: 'bold', offset: i, length: _new_message.length - i});
								break;
							
							case 'em_open':
								italic_open.push(_new_message.length);
								break;
							
							case 'em_close':
								i = italic_open.pop() || 0;
								__entities.push({type: 'italic', offset: i, length: _new_message.length - italic_open});
								break;
							
							case 's_open':
								stroke_open.push(_new_message.length);
								break;
							
							case 's_close':
								i = stroke_open.pop() || 0;
								__entities.push({type: 'strikethrough', offset: i, length: _new_message.length - i});
								break;
							
							case 'underline_open':
								underline_open.push(_new_message.length);
								break;
							
							case 'underline_close':
								i = underline_open.pop() || 0;
								__entities.push({type: 'underline', offset: i, length: _new_message.length - i});
								break;
							
							case 'link_open':
								link_open.push({i: _new_message.length, url: el_ch.attrs[0][1]});
								break;
							
							case 'link_close':
								i = link_open.pop() || {i: 0, url: ''};
								__entities.push({type: 'text_link', offset: i.i, length: _new_message.length - i.i, url: i.url});
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
					underline_open.forEach(i => __entities.push({type: 'underline_open', offset: i, length: _new_message.length - i}));
					link_open.forEach(i => __entities.push({type: 'text_link', offset: i.i, length: _new_message.length - i.i, url: i.url}));
					
					new_message = line_break + prefix;
					_entities = _entities.concat(__entities.map(el => {
						el.offset += new_message.length;
						return el;
					}));
					new_message += _new_message;
					_images = _images.concat(__images);
					
				}else{
					new_message += line_break + prefix + el.content;
				}
				
				prefix = '';
				line_break = '';
				break;
			
			case 'code_block':
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
			}
			
			result.push({message: _message, entities: entities, images: images});
			
			_message = new_message;     // Запоминаем неотправленную часть как новый аккумулятор
			entities = _entities;       // Запоминаем неотправленное оформление
			images = _images;           // Запоминаем неотправленные изображения
			
		}else{  // Размер не превышен. Наращиваем строку для отправки и объединяем оформление с правильным смещением
			entities = entities.concat(_entities.map(el => {
				if(el.type !== 'blockquote'){
					el.offset += _message.length;
				}
				return el;
			}));
			images = images.concat(_images);
			_message += new_message;
		}
		
	}
	
	if(_message.length > 0){
		result.push({message: _message, entities: entities, images: images});
	}
	
	return result;
};