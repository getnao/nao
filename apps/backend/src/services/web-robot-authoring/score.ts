import type { WebRobotRecipe } from '@nao/shared/web-robot';

import type { NormalizedProducts, WebRobotExecutionResult } from '../web-scraper';

export const MIN_AUTHORING_SCORE = 70;

export const scoreExecution = (
	recipe: WebRobotRecipe,
	result: WebRobotExecutionResult & { normalized: NormalizedProducts },
): { score: number; reason?: string } => {
	const { stats, normalized } = result;
	if (stats.failedRequests > 0) {
		return { score: 0, reason: `The candidate failed ${stats.failedRequests} request(s).` };
	}
	if (stats.extractionErrors > 0) {
		return { score: 0, reason: `The candidate produced ${stats.extractionErrors} extraction error(s).` };
	}
	if (normalized.products.length === 0) {
		return { score: 0, reason: 'The candidate produced no products.' };
	}
	if (normalized.products.some((product) => String(product.product_key ?? '').startsWith('record:'))) {
		return { score: 0, reason: 'The candidate does not provide a stable product identity.' };
	}
	if (normalized.products.every((product) => !product.name && !product.sku)) {
		return { score: 0, reason: 'The candidate produced products without names or SKUs.' };
	}
	if (normalized.products.every((product) => !product.source_url && !product.canonical_url && !product.sku)) {
		return { score: 0, reason: 'The candidate produced no product URLs or stable identifiers.' };
	}

	const recordCount = Math.max(
		normalized.products.length,
		...Array.from(result.stageRecords.values()).map((records) => records.length),
	);
	let score = 25 + Math.min(recordCount, 15) * 3;
	const coverage = (field: string) =>
		normalized.products.filter((product) => hasValue(product[field])).length / normalized.products.length;
	if (coverage('name') >= 0.8) {
		score += 12;
	}
	if (coverage('source_url') >= 0.8 || coverage('canonical_url') >= 0.8) {
		score += 10;
	}
	if (coverage('sku') >= 0.8) {
		score += 15;
	}
	if (coverage('price') >= 0.8) {
		score += 8;
	}
	if (normalized.attributes.length) {
		score += 8;
	}
	if (normalized.documents.length) {
		score += 8;
	}
	if (recipe.stages.some((stage) => stage.source.type === 'api')) {
		score += 12;
	}
	if (recipe.stages[0]?.extract?.type === 'jsonld' || recipe.stages[0]?.extract?.type === 'embedded') {
		score += 8;
	}
	if (recipe.stages.some((stage) => stage.source.type === 'browser')) {
		score -= 8;
	}
	if (recipe.stages.some((stage) => stage.paginate)) {
		score += 5;
	}
	return { score: Math.max(0, Math.round(score)) };
};

const hasValue = (value: unknown): boolean => {
	return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
};
