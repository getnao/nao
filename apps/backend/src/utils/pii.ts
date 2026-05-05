export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const ipOctet = '(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
export const IPV4_REGEX = new RegExp(`\\b(?:${ipOctet}\\.){3}${ipOctet}\\b`, 'g');

export const PHONE_REGEX = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

export function maskPII(text: string): string {
	if (!text) return text;

	let masked = text;
	masked = masked.replace(EMAIL_REGEX, '[EMAIL REDACTED]');
	masked = masked.replace(IPV4_REGEX, '[IP REDACTED]');
	masked = masked.replace(PHONE_REGEX, '[PHONE REDACTED]');

	return masked;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function maskPIIValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return maskPII(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => maskPIIValue(item));
	}

	if (isPlainObject(value)) {
		return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, maskPIIValue(nestedValue)]));
	}

	return value;
}
