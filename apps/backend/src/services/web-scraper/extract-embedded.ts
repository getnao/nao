import type { WebRobotExtract } from '@nao/shared/web-robot';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

import { extractJsonFields, matchesRecordFilters } from './extract-json';
import { getPathValue } from './template';

export type WebRobotEmbeddedSource = Extract<WebRobotExtract, { type: 'embedded' }>['sources'][number];
export type WebRobotEmbeddedDocument = {
	source: WebRobotEmbeddedSource;
	value: Record<string, unknown>;
};

type EmbeddedExtract = Extract<WebRobotExtract, { type: 'embedded' }>;

const JSON_ASSIGNMENT_PATTERN = /(?:window\.)?[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(\{.*\}|\[.*\])\s*;?\s*$/s;

export const extractEmbeddedRecords = (
	html: string,
	extract: EmbeddedExtract,
	baseUrl?: string,
): Record<string, unknown>[] => {
	return embeddedDocumentsFromHtml(html, extract.sources).flatMap((document) => {
		return embeddedItems(document.value, extract.itemsPath)
			.filter((item) => matchesRecordFilters(item, extract.where))
			.map((item) => schemaItem(item, extract.schemaTypes))
			.filter((item): item is Record<string, unknown> => item !== null)
			.map((item) => extractJsonFields(item, extract.fields, baseUrl));
	});
};

export const embeddedDocumentsFromHtml = (
	html: string,
	sources: readonly WebRobotEmbeddedSource[],
): WebRobotEmbeddedDocument[] => {
	const wanted = new Set(sources);
	const $ = cheerio.load(html);
	const documents: WebRobotEmbeddedDocument[] = [];

	if (wanted.has('jsonld')) {
		documents.push(...jsonLdDocuments($));
	}
	if (wanted.has('scriptJson')) {
		documents.push(...scriptJsonDocuments($));
	}
	if (wanted.has('microdata')) {
		documents.push(...microdataDocuments($));
	}
	if (wanted.has('rdfa')) {
		documents.push(...rdfaDocuments($));
	}
	if (wanted.has('openGraph')) {
		const document = openGraphDocument($);
		if (document) {
			documents.push(document);
		}
	}
	return documents;
};

const embeddedItems = (document: Record<string, unknown>, itemsPath?: string): unknown[] => {
	const value = itemsPath ? getPathValue(document, itemsPath) : document;
	if (Array.isArray(value)) {
		return value;
	}
	return value === undefined || value === null ? [] : [value];
};

const schemaItem = (item: unknown, schemaTypes?: string[]): Record<string, unknown> | null => {
	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		return null;
	}
	const candidate = item as Record<string, unknown>;
	const effective = effectiveSchemaItem(candidate);
	if (!schemaTypes?.length) {
		return effective;
	}
	const wanted = new Set(schemaTypes.map((type) => type.toLowerCase()));
	const itemTypes = schemaTypeValues(effective);
	return itemTypes.some((type) => wanted.has(type.toLowerCase())) ? effective : null;
};

const effectiveSchemaItem = (item: Record<string, unknown>): Record<string, unknown> => {
	const nested = item.item;
	return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : item;
};

const schemaTypeValues = (item: Record<string, unknown>): string[] => {
	const type = item['@type'] ?? item.itemtype ?? item.type;
	const values = Array.isArray(type) ? type : [type];
	return values.filter((value): value is string => typeof value === 'string').map(schemaTypeName);
};

const schemaTypeName = (value: string): string => {
	return value.split('/').pop() ?? value;
};

const jsonLdDocuments = ($: CheerioAPI): WebRobotEmbeddedDocument[] => {
	const documents: WebRobotEmbeddedDocument[] = [];
	$('script[type="application/ld+json"]').each((_, element) => {
		const parsed = parseJsonText($(element).contents().text());
		for (const item of flattenJsonLd(parsed)) {
			documents.push({ source: 'jsonld', value: item });
		}
	});
	return documents;
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

const scriptJsonDocuments = ($: CheerioAPI): WebRobotEmbeddedDocument[] => {
	const documents: WebRobotEmbeddedDocument[] = [];
	$('script').each((_, element) => {
		const script = $(element);
		const type = (script.attr('type') ?? '').toLowerCase();
		if (type === 'application/ld+json') {
			return;
		}
		const parsed = parseScriptJson(script.contents().text());
		if (parsed && typeof parsed === 'object') {
			documents.push({ source: 'scriptJson', value: parsed as Record<string, unknown> });
		}
	});
	return documents;
};

const parseScriptJson = (text: string): unknown => {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 2 * 1024 * 1024) {
		return null;
	}
	const direct = parseJsonText(trimmed);
	if (direct !== null) {
		return direct;
	}
	const assignment = JSON_ASSIGNMENT_PATTERN.exec(trimmed)?.[1];
	return assignment ? parseJsonText(assignment) : null;
};

const parseJsonText = (text: string): unknown => {
	const trimmed = text.trim();
	if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
		return null;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return null;
	}
};

const microdataDocuments = ($: CheerioAPI): WebRobotEmbeddedDocument[] => {
	return $('[itemscope]')
		.toArray()
		.filter((element) => $(element).parents('[itemscope]').length === 0)
		.map((element) => ({
			source: 'microdata' as const,
			value: microdataItem($, $(element)),
		}))
		.filter((document) => Object.keys(document.value).length > 0);
};

const microdataItem = ($: CheerioAPI, root: ReturnType<CheerioAPI>): Record<string, unknown> => {
	const item: Record<string, unknown> = {};
	const itemType = root.attr('itemtype');
	if (itemType) {
		item['@type'] = schemaTypeName(itemType);
	}
	const itemId = root.attr('itemid');
	if (itemId) {
		item.url = itemId;
	}
	root.find('[itemprop]').each((_, node) => {
		const element = $(node);
		if (element.closest('[itemscope]').get(0) !== root.get(0)) {
			return;
		}
		const name = element.attr('itemprop');
		if (!name) {
			return;
		}
		const value = element.is('[itemscope]') ? microdataItem($, element) : microdataValue(element);
		appendProperty(item, name, value);
	});
	return item;
};

const microdataValue = (element: ReturnType<CheerioAPI>): string => {
	return (
		element.attr('content') ??
		element.attr('href') ??
		element.attr('src') ??
		element.attr('datetime') ??
		element.text()
	).trim();
};

const rdfaDocuments = ($: CheerioAPI): WebRobotEmbeddedDocument[] => {
	return $('[typeof]')
		.toArray()
		.filter((element) => $(element).parents('[typeof]').length === 0)
		.map((element) => {
			const root = $(element);
			const item: Record<string, unknown> = { '@type': root.attr('typeof') };
			root.find('[property]').each((_, node) => {
				const property = $(node).attr('property');
				if (!property) {
					return;
				}
				appendProperty(item, property, $(node).attr('content') ?? $(node).text().trim());
			});
			return { source: 'rdfa' as const, value: item };
		})
		.filter((document) => Object.keys(document.value).length > 1);
};

const openGraphDocument = ($: CheerioAPI): WebRobotEmbeddedDocument | null => {
	const item: Record<string, unknown> = {};
	$('meta[property^="og:"]').each((_, element) => {
		const property = $(element).attr('property');
		const content = $(element).attr('content');
		if (!property || !content) {
			return;
		}
		const name = property.replace(/^og:/, '').replace(/:([a-z])/g, (_, letter: string) => letter.toUpperCase());
		appendProperty(item, name, content);
	});
	return Object.keys(item).length ? { source: 'openGraph', value: item } : null;
};

const appendProperty = (item: Record<string, unknown>, name: string, value: unknown): void => {
	const existing = item[name];
	if (existing === undefined) {
		item[name] = value;
		return;
	}
	item[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
};
