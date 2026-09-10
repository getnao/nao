import type { WebRobotExtract, WebRobotTransform } from '@nao/shared/web-robot';
import type { Cheerio, CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

import { applyTransforms } from './transforms';

type DomExtract = Extract<WebRobotExtract, { type: 'dom' }>;
type DomField = DomExtract['fields'][string];

export const extractDomRecords = (html: string, extract: DomExtract, baseUrl: string): Record<string, unknown>[] => {
	const $ = cheerio.load(html);
	const items = extract.itemSelector ? $(extract.itemSelector).toArray() : $.root().toArray();

	return items.map((item) => extractDomFields($, $(item), extract.fields, baseUrl));
};

export const findNextLink = (html: string, selector: string, attr: string, baseUrl: string): string | null => {
	const $ = cheerio.load(html);
	const value = $(selector).first().attr(attr);
	return value ? new URL(value, baseUrl).toString() : null;
};

const extractDomFields = (
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	fields: Record<string, DomField>,
	baseUrl: string,
): Record<string, unknown> => {
	const output: Record<string, unknown> = {};

	for (const [name, field] of Object.entries(fields)) {
		let value = field.each
			? extractRepeatedFields($, root, field, baseUrl)
			: extractFieldValue($, root, field, baseUrl);

		if (value === undefined && field.default !== undefined) {
			value = field.default;
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

const extractFieldValue = ($: CheerioAPI, root: Cheerio<AnyNode>, field: DomField, baseUrl: string): unknown => {
	const matches = field.selector ? root.find(field.selector) : root;
	const values = matches.toArray().map((element) => elementValue($, $(element), field));
	const transformed = values.map((value) => applyTransforms(value, field.transforms as WebRobotTransform[], baseUrl));

	if (field.multiple) {
		return transformed;
	}
	return transformed[0];
};

const extractRepeatedFields = ($: CheerioAPI, root: Cheerio<AnyNode>, field: DomField, baseUrl: string): unknown => {
	return root
		.find(field.each!)
		.toArray()
		.map((element) => {
			const row = $(element);
			const name = field.name ? row.find(field.name).first().text().trim() : undefined;
			const value = field.value ? row.find(field.value).first().text().trim() : undefined;
			const unit = field.unit ? row.find(field.unit).first().text().trim() : undefined;
			return {
				...(name ? { name: applyTransforms(name, field.transforms as WebRobotTransform[], baseUrl) } : {}),
				...(value ? { value } : {}),
				...(unit ? { unit } : {}),
			};
		})
		.filter((entry) => Object.keys(entry).length > 0);
};

const elementValue = ($: CheerioAPI, element: Cheerio<AnyNode>, field: DomField): string => {
	if (field.attr) {
		return element.attr(field.attr) ?? '';
	}
	return field.format === 'html' ? ($.html(element) ?? '') : element.text();
};

const isMissing = (value: unknown): boolean => {
	return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
};
