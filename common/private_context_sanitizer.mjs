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

export function redactSecrets(value){
	let text = String(value ?? '');
	for(const pattern of SECRET_PATTERNS){
		text = text.replace(pattern, '[REDACTED:secret]');
	}
	return text;
}

export function hasLikelySecret(value){
	const text = String(value ?? '');
	return SECRET_PATTERNS.some(pattern => {
		pattern.lastIndex = 0;
		return pattern.test(text);
	});
}

export function sanitizeObjectDeep(value){
	if(typeof value === 'string'){
		return redactSecrets(value);
	}

	if(Array.isArray(value)){
		return value.map(sanitizeObjectDeep);
	}

	if(value && typeof value === 'object'){
		const result = {};
		for(const [key, child] of Object.entries(value)){
			if(key === 'private_context' || key === 'private_context_type'){
				continue;
			}
			result[key] = sanitizeObjectDeep(child);
		}
		return result;
	}

	return value;
}

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

export function stripPrivateContextFields(messages){
	return (messages || []).map(message => {
		if(!message || typeof message !== 'object'){
			return message;
		}

		const {private_context, private_context_type, ...cleanMessage} = message;
		return cleanMessage;
	});
}

export function sanitizeAIParams(aiParams){
	if(!aiParams || typeof aiParams !== 'object'){
		return aiParams;
	}

	return {
		...sanitizeObjectDeep(aiParams),
		messages: sanitizeAIMessages(aiParams.messages)
	};
}

export function sanitizeAIResponse(response){
	return sanitizeObjectDeep(response);
}
