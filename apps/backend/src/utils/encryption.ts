import crypto from 'node:crypto';

import { env } from '../env';

const ALGORITHM = 'aes-256-gcm';

/** Derives a stable 32-byte key from the app secret. */
function getKey(): Buffer {
	return crypto.createHash('sha256').update(env.BETTER_AUTH_SECRET).digest();
}

/**
 * Encrypts a string with AES-256-GCM. Output format is `iv.tag.ciphertext`,
 * each part base64url-encoded. Use for secrets that must be readable later
 * (e.g. OAuth tokens), unlike one-way hashing.
 */
export function encryptSecret(plaintext: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
	const [ivPart, tagPart, dataPart] = payload.split('.');
	if (!ivPart || !tagPart || !dataPart) {
		throw new Error('Invalid encrypted payload');
	}
	const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64url'));
	decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}
