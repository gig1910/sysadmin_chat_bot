const SECRET_PATTERNS = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{20,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\b(?:password|passwd|pwd|token|api[_-]?key|secret)\s*[=:]\s*[^\s;&]+/gim
];

/**
 * Вымарывание секретоподобных строк.
 * @param {*} value
 * @returns {String}
 */
export function redactSecrets(value){
	let text = String(value ?? '');
	for(const pattern of SECRET_PATTERNS){
		pattern.lastIndex = 0;
		text = text.replace(pattern, '[REDACTED:secret]');
	}
	return text;
}

/**
 * Проверка строки/объекта на похожесть на секрет.
 * @param {*} value
 * @returns {Boolean}
 */
export function hasLikelySecret(value){
	const text = String(value ?? '');
	return SECRET_PATTERNS.some(pattern => {
		pattern.lastIndex = 0;
		return pattern.test(text);
	});
}

/**
 * Рекурсивная очистка объекта от секретов и private_context метаданных.
 * Защищена от циклических ссылок.
 * @param {*} value
 * @param {WeakSet} [seen]
 * @returns {*}
 */
export function sanitizeObjectDeep(value, seen = new WeakSet()){
	if(typeof value === 'string'){
		return redactSecrets(value);
	}

	if(typeof value === 'bigint'){
		return value.toString();
	}

	if(typeof value === 'function' || typeof value === 'symbol'){
		return undefined;
	}

	if(Array.isArray(value)){
		if(seen.has(value)){
			return '[Circular]';
		}
		seen.add(value);
		const result = value.map(child => sanitizeObjectDeep(child, seen));
		seen.delete(value);
		return result;
	}

	if(value && typeof value === 'object'){
		if(seen.has(value)){
			return '[Circular]';
		}
		seen.add(value);

		const result = {};
		for(const [key, child] of Object.entries(value)){
			if(key === 'private_context' || key === 'private_context_type'){
				continue;
			}
			result[key] = sanitizeObjectDeep(child, seen);
		}

		seen.delete(value);
		return result;
	}

	return value;
}

/**
 * Очистка списка сообщений AI перед логированием/сохранением.
 * @param {Object[]} messages
 * @returns {Object[]}
 */
export function sanitizeAIMessages(messages){
	return (messages || []).map(message => {
		if(message?.private_context){
			return {
				role: message.role,
				content: `[REDACTED:${message.private_context_type || 'private_context'}]`
			};
		}

		return sanitizeObjectDeep(message);
	});
}

/**
 * Удаление внутренних полей private_context перед отправкой в AI API.
 * @param {Object[]} messages
 * @returns {Object[]}
 */
export function stripPrivateContextFields(messages){
	return (messages || []).map(message => {
		if(!message || typeof message !== 'object'){
			return message;
		}

		const {private_context, private_context_type, ...cleanMessage} = message;
		return cleanMessage;
	});
}

/**
 * Очистка параметров AI-запроса.
 * @param {Object} aiParams
 * @returns {Object}
 */
export function sanitizeAIParams(aiParams){
	if(!aiParams || typeof aiParams !== 'object'){
		return aiParams;
	}

	return {
		...sanitizeObjectDeep(aiParams),
		messages: sanitizeAIMessages(aiParams.messages)
	};
}

/**
 * Очистка ответа AI перед логированием/сохранением.
 * @param {*} response
 * @returns {*}
 */
export function sanitizeAIResponse(response){
	return sanitizeObjectDeep(response);
}
