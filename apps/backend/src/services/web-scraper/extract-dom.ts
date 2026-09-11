import type { WebRobotElementFingerprint, WebRobotExtract, WebRobotTransform } from '@nao/shared/web-robot';
import type { Cheerio, CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

import {
	elementFingerprintScore,
	normalizeFingerprintText,
	type WebRobotElementDescriptor,
} from './element-fingerprint';
import { applyTransforms } from './transforms';
import type { WebRobotRunWarning } from './types';

type DomExtract = Extract<WebRobotExtract, { type: 'dom' }>;
type DomField = DomExtract['fields'][string];

export const extractDomRecords = (
	html: string,
	extract: DomExtract,
	baseUrl: string,
	onWarning?: (warning: WebRobotRunWarning) => void,
): Record<string, unknown>[] => {
	const $ = cheerio.load(html);
	const itemSelector = firstMatchingSelector($, selectorCandidates(extract.itemSelector, extract.itemSelectors));
	let items = itemSelector ? $(itemSelector).toArray() : $.root().toArray();
	if (itemSelector && itemSelector !== extract.itemSelector) {
		onWarning?.({
			kind: 'selector_fallback',
			field: 'itemSelector',
			selector: extract.itemSelector,
			fallback: itemSelector,
			message: `Item selector '${extract.itemSelector ?? '(none)'}' did not match; used '${itemSelector}'`,
		});
	}
	if (!itemSelector && extract.itemFingerprint) {
		const relocated = fingerprintElements($, $.root(), extract.itemFingerprint, { threshold: 40, limit: 100 });
		if (relocated.length) {
			items = relocated;
			onWarning?.({
				kind: 'selector_fallback',
				field: 'itemSelector',
				selector: extract.itemSelector,
				fallback: `fingerprint:${extract.itemFingerprint.tag}`,
				relocated: true,
				message: `Item selector '${extract.itemSelector ?? '(none)'}' did not match; relocated by element fingerprint`,
			});
		}
	}

	return items.map((item) => extractDomFields($, $(item), extract.fields, baseUrl, onWarning));
};

export const findNextLink = (
	html: string,
	selector: string,
	attr: string,
	baseUrl: string,
	selectors: string[] = [],
	fingerprint?: WebRobotElementFingerprint,
	onWarning?: (warning: WebRobotRunWarning) => void,
): string | null => {
	const $ = cheerio.load(html);
	for (const candidate of selectorCandidates(selector, selectors)) {
		const value = $(candidate).first().attr(attr);
		if (value) {
			if (candidate !== selector) {
				onWarning?.({
					kind: 'pagination_fallback',
					selector,
					fallback: candidate,
					message: `Pagination selector '${selector}' did not match; used '${candidate}'`,
				});
			}
			return new URL(value, baseUrl).toString();
		}
	}
	if (fingerprint) {
		const relocated = fingerprintElements($, $.root(), fingerprint, { threshold: 35, limit: 1 })[0];
		const value = relocated ? $(relocated).attr(attr) : undefined;
		if (value) {
			onWarning?.({
				kind: 'pagination_fallback',
				selector,
				fallback: `fingerprint:${fingerprint.tag}`,
				relocated: true,
				message: `Pagination selector '${selector}' did not match; relocated by element fingerprint`,
			});
			return new URL(value, baseUrl).toString();
		}
	}
	return null;
};

const extractDomFields = (
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	fields: Record<string, DomField>,
	baseUrl: string,
	onWarning?: (warning: WebRobotRunWarning) => void,
): Record<string, unknown> => {
	const output: Record<string, unknown> = {};

	for (const [name, field] of Object.entries(fields)) {
		let value = field.each
			? extractRepeatedFields($, root, field, baseUrl, onWarning)
			: extractFieldValue($, root, field, baseUrl, name, onWarning);

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

const extractFieldValue = (
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	field: DomField,
	baseUrl: string,
	name: string,
	onWarning?: (warning: WebRobotRunWarning) => void,
): unknown => {
	const candidates = selectorCandidates(field.selector, field.selectors);
	const selector = candidates.find((candidate) => hasUsableValue($, root, candidate, field));
	let matches = selector
		? root.find(selector).toArray()
		: candidates.length
			? root.find(candidates[0]!).toArray()
			: root.toArray();
	if (selector && selector !== field.selector) {
		onWarning?.({
			kind: 'selector_fallback',
			field: name,
			selector: field.selector,
			fallback: selector,
			message: `Field '${name}' selector '${field.selector ?? '(root)'}' had no usable value; used '${selector}'`,
		});
	}
	if (!selector && field.fingerprint) {
		const relocated = fingerprintElements($, root, field.fingerprint, {
			threshold: 35,
			limit: field.multiple ? 8 : 1,
		});
		if (relocated.length) {
			matches = relocated;
			onWarning?.({
				kind: 'selector_fallback',
				field: name,
				selector: field.selector,
				fallback: `fingerprint:${field.fingerprint.tag}`,
				relocated: true,
				message: `Field '${name}' selector '${field.selector ?? '(root)'}' had no usable value; relocated by element fingerprint`,
			});
		}
	}
	const values = matches.map((element) => elementValue($, $(element), field));
	if (field.multiple) {
		return applyTransforms(values, field.transforms as WebRobotTransform[], baseUrl);
	}
	return applyTransforms(values[0], field.transforms as WebRobotTransform[], baseUrl);
};

const extractRepeatedFields = (
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	field: DomField,
	baseUrl: string,
	onWarning?: (warning: WebRobotRunWarning) => void,
): unknown => {
	return root
		.find(field.each!)
		.toArray()
		.map((element) => {
			const row = $(element);
			if (field.fields) {
				return extractDomFields($, row, field.fields, baseUrl, onWarning);
			}
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

const selectorCandidates = (primary?: string, alternates: string[] = []): string[] => {
	return [...new Set([primary, ...alternates].filter((selector): selector is string => Boolean(selector)))];
};

const firstMatchingSelector = ($: CheerioAPI, selectors: string[]): string | undefined => {
	return selectors.find((selector) => {
		try {
			return $(selector).length > 0;
		} catch {
			return false;
		}
	});
};

const hasUsableValue = ($: CheerioAPI, root: Cheerio<AnyNode>, selector: string, field: DomField): boolean => {
	try {
		return root
			.find(selector)
			.toArray()
			.some((element) => elementValue($, $(element), field).trim().length > 0);
	} catch {
		return false;
	}
};

const fingerprintElements = (
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	fingerprint: WebRobotElementFingerprint,
	options: { threshold: number; limit: number },
): AnyNode[] => {
	const candidates = [...root.toArray(), ...root.find('*').toArray()];
	return [...new Set(candidates)]
		.map((element) => {
			const descriptor = elementDescriptor($, $(element));
			return descriptor
				? { element, score: elementFingerprintScore(fingerprint, descriptor) }
				: { element, score: 0 };
		})
		.filter((candidate) => candidate.score >= options.threshold)
		.sort((left, right) => right.score - left.score)
		.slice(0, options.limit)
		.map((candidate) => candidate.element);
};

const elementDescriptor = ($: CheerioAPI, element: Cheerio<AnyNode>): WebRobotElementDescriptor | undefined => {
	const node = element.get(0);
	const tag =
		element.prop('tagName')?.toLowerCase() ?? (node && 'name' in node ? node.name.toLowerCase() : undefined);
	if (!tag || node?.type !== 'tag') {
		return undefined;
	}
	const attributes = Object.fromEntries(
		Object.entries(node.attribs ?? {}).filter(([name]) => name !== 'class' && name !== 'style'),
	);
	return {
		tag,
		attributes,
		classes: (node.attribs?.class ?? '').split(/\s+/).filter(Boolean),
		childTags: element
			.children()
			.toArray()
			.map((child) => (child.type === 'tag' ? child.name.toLowerCase() : undefined))
			.filter((child): child is string => Boolean(child)),
		text: normalizeFingerprintText(element.text()),
	};
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
