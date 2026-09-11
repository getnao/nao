import { createHash } from 'node:crypto';

import type { WebRobotTransform } from '@nao/shared/web-robot';

export const applyTransforms = (
	value: unknown,
	transforms: WebRobotTransform[] | undefined,
	baseUrl?: string,
): unknown => {
	let current = value;
	for (const transform of transforms ?? []) {
		current = applyTransform(current, transform, baseUrl);
	}
	return current;
};

const applyTransform = (value: unknown, transform: WebRobotTransform, baseUrl?: string): unknown => {
	if (typeof transform === 'string') {
		return applySimpleTransform(value, transform, baseUrl);
	}

	switch (transform.type) {
		case 'regex': {
			const match = String(value ?? '').match(new RegExp(transform.pattern));
			return match?.[transform.group ?? 0] ?? null;
		}
		case 'replace':
			return String(value ?? '').replace(new RegExp(transform.pattern, 'g'), transform.replacement);
		case 'join':
			return Array.isArray(value) ? value.map((entry) => String(entry ?? '')).join(transform.separator) : value;
		case 'map':
			return transform.values[String(value ?? '')] ?? value;
	}
};

const applySimpleTransform = (value: unknown, transform: string, baseUrl?: string): unknown => {
	switch (transform) {
		case 'trim':
			return mapScalar(value, (entry) => entry.trim());
		case 'normalizeWhitespace':
			return mapScalar(value, (entry) => entry.replace(/\s+/g, ' ').trim());
		case 'lowercase':
			return mapScalar(value, (entry) => entry.toLowerCase());
		case 'uppercase':
			return mapScalar(value, (entry) => entry.toUpperCase());
		case 'absoluteUrl':
			return mapScalar(value, (entry) => (baseUrl ? new URL(entry, baseUrl).toString() : entry));
		case 'stripHtml':
			return mapScalar(value, (entry) =>
				entry
					.replace(/<[^>]*>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim(),
			);
		case 'parseNumber':
			return parseNumber(value);
		case 'parsePrice':
			return parsePrice(value);
		case 'hashValue':
			return createHash('sha256').update(stableStringify(value)).digest('hex');
		default:
			return value;
	}
};

const mapScalar = (value: unknown, transform: (value: string) => string): unknown => {
	if (Array.isArray(value)) {
		return value.map((entry) => transform(String(entry ?? '')));
	}
	return transform(String(value ?? ''));
};

const parseNumber = (value: unknown): number | null => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const match = String(value ?? '').match(/-?\d[\d\s,.]*/);
	if (!match) {
		return null;
	}
	const normalized = match[0]
		.replace(/\s/g, '')
		.replace(/,(?=\d{3}\b)/g, '')
		.replace(',', '.');
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
};

const parsePrice = (value: unknown): { amount: number; currency?: string } | null => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? { amount: value } : null;
	}
	const text = String(value ?? '');
	const amount = parseNumber(text);
	if (amount === null) {
		return null;
	}
	const currency = text.match(/([A-Z]{3}|€|£|\$)/)?.[1];
	return { amount, ...(currency ? { currency } : {}) };
};

const stableStringify = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
};
