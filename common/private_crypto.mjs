import crypto from 'node:crypto';

const MASTER_KEY_RAW = process.env.AI_MEMORY_MASTER_KEY || process.env.MEMORY_MASTER_KEY || '';
const DEFAULT_KEY_ID = process.env.AI_MEMORY_KEY_ID || 'memory-key-v1';
const SALT_PREFIX = 'sysadmin_chat_bot:private-context:v1';
const ALGORITHM = 'aes-256-gcm';

export function isPrivateCryptoConfigured(){
	return MASTER_KEY_RAW.trim().length > 0;
}

function getMasterKey(){
	const raw = MASTER_KEY_RAW.trim();
	if(!raw){
		throw new Error('AI memory encryption key is not configured. Set AI_MEMORY_MASTER_KEY.');
	}

	const base64 = Buffer.from(raw, 'base64');
	if(base64.length >= 32 && base64.toString('base64').replace(/=+$/u, '') === raw.replace(/=+$/u, '')){
		return base64.subarray(0, 32);
	}

	const hex = Buffer.from(raw, 'hex');
	if(hex.length >= 32 && /^[0-9a-f]+$/iu.test(raw)){
		return hex.subarray(0, 32);
	}

	return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function getAad(chatId, userId, contextType){
	return Buffer.from(`${SALT_PREFIX}:${contextType}:${chatId}:${userId}`, 'utf8');
}

function derivePrivateContextKey(chatId, userId, contextType){
	return crypto.hkdfSync(
		'sha256',
		getMasterKey(),
		Buffer.from(SALT_PREFIX, 'utf8'),
		Buffer.from(`${contextType}:${chatId}:${userId}`, 'utf8'),
		32
	);
}

export function encryptPrivateJson({chatId, userId, contextType, data, keyId = DEFAULT_KEY_ID}){
	const iv = crypto.randomBytes(12);
	const key = derivePrivateContextKey(chatId, userId, contextType);
	const aad = getAad(chatId, userId, contextType);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	cipher.setAAD(aad);

	const plaintext = Buffer.from(JSON.stringify(data ?? {}), 'utf8');
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();

	return {
		v: 1,
		alg: 'AES-256-GCM',
		kid: keyId,
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		data: encrypted.toString('base64')
	};
}

export function decryptPrivateJson({chatId, userId, contextType, envelope}){
	if(!envelope){
		return null;
	}

	if(envelope.alg !== 'AES-256-GCM' || envelope.v !== 1){
		throw new Error(`Unsupported private context envelope: v=${envelope.v}; alg=${envelope.alg}`);
	}

	const key = derivePrivateContextKey(chatId, userId, contextType);
	const aad = getAad(chatId, userId, contextType);
	const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'));
	decipher.setAAD(aad);
	decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(envelope.data, 'base64')),
		decipher.final()
	]);

	return JSON.parse(decrypted.toString('utf8'));
}
