import type { WebRobotExtract, WebRobotTransform } from '@nao/shared/web-robot';

import { getPathValue } from './template';
import { applyTransforms } from './transforms';

export const extractJsonRecords = (
	body: unknown,
	extract: Extract<WebRobotExtract, { type: 'json' | 'network' }>,
	baseUrl?: string,
): Record<string, unknown>[] => {
	const items = jsonItems(body, extract.itemsPath);

	return items.map((item) => extractJsonFields(item, extract.fields, baseUrl));
};

export const extractJsonFields = (
	item: unknown,
	fields: Record<
		string,
		{ path?: string; multiple?: boolean; required?: boolean; default?: unknown; transforms?: WebRobotTransform[] }
	>,
	baseUrl?: string,
): Record<string, unknown> => {
	const output: Record<string, unknown> = {};

	for (const [name, field] of Object.entries(fields)) {
		let value = field.path === undefined || field.path === '' ? item : getPathValue(item, field.path);
		if (value === undefined && field.default !== undefined) {
			value = field.default;
		}
		if (value !== undefined) {
			value = applyTransforms(value, field.transforms, baseUrl);
		}
		if (field.multiple && value !== undefined && !Array.isArray(value)) {
			value = [value];
		}
		if (field.required && isMissing(value)) {
			throw new Error(`Required field '${name}' is missing`);
		}
		if (!isMissing(value)) {
			output[name] = value;
		}
	}

	return output;
};

const jsonItems = (body: unknown, itemsPath?: string): unknown[] => {
	const value = itemsPath ? getPathValue(body, itemsPath) : body;
	if (Array.isArray(value)) {
		return value;
	}
	return value === undefined || value === null ? [] : [value];
};

const isMissing = (value: unknown): boolean => {
	return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
};
