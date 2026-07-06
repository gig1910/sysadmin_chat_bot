const DEFAULT_DANGEROUS_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Проверка, что значение является простым JSON-объектом.
 * @param {*} value
 * @returns {Boolean}
 */
export function isPlainObject(value){
	if(!value || typeof value !== 'object' || Array.isArray(value)){
		return false;
	}

	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Проверка, что значение похоже на OpenAI-compatible chat message.
 * @param {*} value
 * @returns {Boolean}
 */
export function isChatMessageLike(value){
	return Boolean(
		isPlainObject(value) &&
		['assistant', 'user', 'system', 'tool'].includes(value.role) &&
		typeof value.content === 'string'
	);
}

/**
 * Удаление Markdown code-fence вокруг JSON-строки.
 * @param {*} content
 * @returns {String}
 */
export function stripJsonFence(content){
	const text = String(content || '').trim();
	const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
	return match ? match[1].trim() : text;
}

/**
 * Безопасная сериализация в JSON-строку.
 * Защищает от циклических ссылок, BigInt, function и symbol.
 * @param {*} value
 * @param {String|Number} [space='']
 * @returns {?String}
 */
export function json2string(value, space = ''){
	if(value == null){
		return null;
	}

	const seen = new WeakSet();
	return JSON.stringify(value, (key, child) => {
		if(typeof child === 'bigint'){
			return child.toString();
		}

		if(typeof child === 'function' || typeof child === 'symbol'){
			return undefined;
		}

		if(child && typeof child === 'object'){
			if(seen.has(child)){
				return '[Circular]';
			}
			seen.add(child);
		}

		return child;
	}, space);
}

/**
 * Безопасное слияние JSON-объектов с защитой от циклов и опасных ключей.
 * @param {Object} target
 * @param {Object} patch
 * @param {{max_depth?: Number, dangerous_keys?: Set<String>, on_skip_key?: Function}} [options]
 * @param {WeakSet} [seen]
 * @param {Number} [depth]
 * @returns {Object}
 */
export function deepMerge(target, patch, options = {}, seen = new WeakSet(), depth = 0){
	const max_depth = Number.isInteger(options.max_depth) ? options.max_depth : 16;
	const dangerous_keys = options.dangerous_keys instanceof Set ? options.dangerous_keys : DEFAULT_DANGEROUS_JSON_KEYS;

	if(depth > max_depth){
		throw new Error('Превышена максимальная глубина merge JSON-объектов.');
	}

	if(!patch || typeof patch !== 'object' || Array.isArray(patch)){
		return target;
	}

	if(seen.has(patch)){
		throw new Error('Обнаружена циклическая ссылка в patch JSON-объекта.');
	}
	seen.add(patch);

	const result = {...(isPlainObject(target) ? target : {})};
	for(const [key, value] of Object.entries(patch)){
		if(dangerous_keys.has(key)){
			if(typeof options.on_skip_key === 'function'){
				options.on_skip_key(key, value);
			}
			continue;
		}

		if(isPlainObject(value)){
			result[key] = deepMerge(result[key], value, options, seen, depth + 1);
		}else{
			result[key] = value;
		}
	}

	seen.delete(patch);
	return result;
}
