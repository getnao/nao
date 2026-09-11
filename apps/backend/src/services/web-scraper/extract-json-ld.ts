import type { WebRobotExtract } from '@nao/shared/web-robot';
import * as cheerio from 'cheerio';

import { extractJsonFields } from './extract-json';

type JsonLdExtract = Extract<WebRobotExtract, { type: 'jsonld' }>;

export const extractJsonLdRecords = (
	html: string,
	extract: JsonLdExtract,
	baseUrl: string,
): Record<string, unknown>[] => {
	const $ = cheerio.load(html);
	const wantedTypes = new Set(extract.schemaTypes.map((type) => type.toLowerCase()));
	const records: Record<string, unknown>[] = [];

	$('script[type="application/ld+json"]').each((_, element) => {
		const text = $(element).contents().text().trim();
		if (!text) {
			return;
		}

		try {
			for (const item of flattenJsonLd(JSON.parse(text))) {
				if (!matchesSchemaType(item, wantedTypes)) {
					continue;
				}
				const listItems = item.itemListElement;
				if (hasSchemaType(item, 'ItemList') && Array.isArray(listItems)) {
					records.push(...listItems.map((entry) => extractJsonFields(entry, extract.fields, baseUrl)));
					continue;
				}
				records.push(extractJsonFields(item, extract.fields, baseUrl));
			}
		} catch {
			return;
		}
	});

	return records;
};

const flattenJsonLd = (value: unknown): Record<string, unknown>[] => {
	if (Array.isArray(value)) {
		return value.flatMap(flattenJsonLd);
	}
	if (!value || typeof value !== 'object') {
		return [];
	}

	const object = value as Record<string, unknown>;
	const graph = Array.isArray(object['@graph']) ? object['@graph'].flatMap(flattenJsonLd) : [];
	return [object, ...graph];
};

const hasSchemaType = (item: Record<string, unknown>, wantedType: string): boolean => {
	return matchesSchemaType(item, new Set([wantedType.toLowerCase()]));
};

const matchesSchemaType = (item: Record<string, unknown>, wantedTypes: Set<string>): boolean => {
	const type = item['@type'];
	const types = Array.isArray(type) ? type : [type];
	return types.some((entry) => typeof entry === 'string' && wantedTypes.has(entry.toLowerCase()));
};
