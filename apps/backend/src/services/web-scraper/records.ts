import { createHash } from 'node:crypto';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

import type { WebRobotStageRecord } from './types';
import { canonicalHttpUrl } from './url-policy';

const PRODUCT_COLUMNS = [
	'product_key',
	'source_url',
	'canonical_url',
	'name',
	'sku',
	'brand',
	'description',
	'price',
	'currency',
	'categories_json',
	'image_urls_json',
	'attributes_json',
	'raw_json',
	'content_hash',
	'run_id',
	'scraped_at',
];

export type ProductAttributeRow = {
	product_key: string;
	name: string;
	value: string;
	unit?: string | null;
	source_url?: string | null;
	run_id?: string;
};

export type ProductDocumentRow = {
	product_key: string;
	title: string;
	url: string;
	document_type?: string | null;
	run_id?: string;
};

export type NormalizedProducts = {
	products: Record<string, unknown>[];
	attributes: ProductAttributeRow[];
	documents: ProductDocumentRow[];
};

export const normalizeProducts = (
	records: WebRobotStageRecord[],
	recipe: WebRobotRecipe,
	runId?: string,
	scrapedAt = new Date().toISOString(),
): NormalizedProducts => {
	const recordsByKey = new Map<string, { data: Record<string, unknown>; sourceUrl?: string }>();
	for (const record of records) {
		const data = { ...record.data };
		const sourceUrl = stringValue(data.source_url ?? data.url ?? record.url);
		const canonicalUrl = sourceUrl ? safeCanonicalUrl(sourceUrl) : null;
		const productKey = productKeyFor(data, recipe, canonicalUrl ?? sourceUrl);
		const existing = recordsByKey.get(productKey);
		recordsByKey.set(productKey, {
			data: existing ? { ...existing.data, ...data } : data,
			sourceUrl: sourceUrl ?? existing?.sourceUrl,
		});
	}

	const products: Record<string, unknown>[] = [];
	const attributes: ProductAttributeRow[] = [];
	const documents: ProductDocumentRow[] = [];

	for (const [productKey, record] of recordsByKey) {
		const data = record.data;
		const sourceUrl = record.sourceUrl;
		const canonicalUrl = sourceUrl ? safeCanonicalUrl(sourceUrl) : null;
		products.push({
			product_key: productKey,
			source_url: sourceUrl ?? canonicalUrl,
			canonical_url: canonicalUrl,
			name: data.name ?? null,
			sku: data.sku ?? null,
			brand: data.brand ?? null,
			description: data.description ?? null,
			price: priceAmount(data.price),
			currency: data.currency ?? priceCurrency(data.price),
			categories_json: jsonString(data.categories),
			image_urls_json: jsonString(normalizeList(data.images ?? data.image_urls ?? data.image_url, canonicalUrl)),
			attributes_json: jsonString(data.attributes ?? {}),
			raw_json: jsonString(data),
			content_hash: contentHash(data),
			run_id: runId,
			scraped_at: scrapedAt,
		});
		attributes.push(...attributeRows(productKey, data.attributes, sourceUrl, runId));
		documents.push(...documentRows(productKey, data.documents ?? data.document_urls, canonicalUrl, runId));
	}

	return { products, attributes, documents };
};

export const productColumns = (): string[] => PRODUCT_COLUMNS;

const productKeyFor = (data: Record<string, unknown>, recipe: WebRobotRecipe, fallbackUrl?: string): string => {
	const parts = recipe.identity.fields
		.map((field) => ({ field, value: identityValue(data[field], field) }))
		.filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== '');

	if (parts.length === 0 && fallbackUrl) {
		return `url:${fallbackUrl}`;
	}
	if (parts.length === 0) {
		return `record:${sha256(stableStringify(data))}`;
	}
	return `key:${sha256(parts.map((part) => `${part.field}=${String(part.value)}`).join('|'))}`;
};

const identityValue = (value: unknown, field: string): unknown => {
	if (field === 'url' && typeof value === 'string') {
		return safeCanonicalUrl(value) ?? value;
	}
	return value;
};

const contentHash = (data: Record<string, unknown>): string => {
	const copy = { ...data };
	delete copy.run_id;
	delete copy.scraped_at;
	delete copy.content_hash;
	return sha256(stableStringify(copy));
};

const attributeRows = (
	productKey: string,
	attributes: unknown,
	sourceUrl: string | undefined,
	runId: string | undefined,
): ProductAttributeRow[] => {
	if (Array.isArray(attributes)) {
		return attributes.flatMap((entry) => {
			if (!entry || typeof entry !== 'object') {
				return [];
			}
			const row = entry as Record<string, unknown>;
			const name = stringValue(row.name);
			const value = stringValue(row.value);
			if (!name || value === undefined) {
				return [];
			}
			return [
				{
					product_key: productKey,
					name,
					value,
					unit: stringValue(row.unit) ?? null,
					source_url: sourceUrl ?? null,
					run_id: runId,
				},
			];
		});
	}

	if (attributes && typeof attributes === 'object') {
		return Object.entries(attributes as Record<string, unknown>).flatMap(([name, value]) => {
			const text = stringValue(value);
			return text === undefined
				? []
				: [{ product_key: productKey, name, value: text, source_url: sourceUrl ?? null, run_id: runId }];
		});
	}

	return [];
};

const documentRows = (
	productKey: string,
	documents: unknown,
	baseUrl: string | null,
	runId: string | undefined,
): ProductDocumentRow[] => {
	return normalizeList(documents, baseUrl).flatMap((entry) => {
		if (typeof entry === 'string') {
			return [{ product_key: productKey, title: entry, url: entry, run_id: runId }];
		}
		if (!entry || typeof entry !== 'object') {
			return [];
		}
		const row = entry as Record<string, unknown>;
		const url = stringValue(row.url ?? row.href);
		if (!url) {
			return [];
		}
		return [
			{
				product_key: productKey,
				title: stringValue(row.title ?? row.name ?? row.label) ?? url,
				url: safeCanonicalUrl(url, baseUrl ?? undefined) ?? url,
				document_type: stringValue(row.type ?? row.document_type) ?? null,
				run_id: runId,
			},
		];
	});
};

const normalizeList = (value: unknown, baseUrl?: string | null): unknown[] => {
	const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	return entries.map((entry) => {
		if (typeof entry !== 'string') {
			return entry;
		}
		return safeCanonicalUrl(entry, baseUrl ?? undefined) ?? entry;
	});
};

const safeCanonicalUrl = (value: string, baseUrl?: string): string | null => {
	try {
		return canonicalHttpUrl(value, baseUrl);
	} catch {
		return null;
	}
};

const priceAmount = (value: unknown): unknown => {
	return value && typeof value === 'object' && 'amount' in value ? (value as { amount?: unknown }).amount : value;
};

const priceCurrency = (value: unknown): unknown => {
	return value && typeof value === 'object' && 'currency' in value
		? (value as { currency?: unknown }).currency
		: undefined;
};

const stringValue = (value: unknown): string | undefined => {
	if (value === undefined || value === null) {
		return undefined;
	}
	return typeof value === 'string' ? value : JSON.stringify(value);
};

const jsonString = (value: unknown): string => JSON.stringify(value ?? null);

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

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
