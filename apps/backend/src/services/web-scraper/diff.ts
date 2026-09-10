import type { WebRobotRecipe } from '@nao/shared/web-robot';

export type ProductDiff = {
	added: string[];
	removed: string[];
	changed: string[];
	unchanged: string[];
	changes: ProductChange[];
};

export type ProductChange = {
	change_type: 'added' | 'removed' | 'changed';
	product_key: string;
	field?: string;
	old_value?: unknown;
	new_value?: unknown;
};

const DIFF_IGNORED_FIELDS = new Set(['run_id', 'scraped_at', 'last_seen_at', 'first_seen_at']);

export const diffProducts = (
	previous: Record<string, unknown>[],
	current: Record<string, unknown>[],
	_recipe: WebRobotRecipe,
): ProductDiff => {
	const previousByKey = new Map(previous.map((row) => [String(row.product_key), row]));
	const currentByKey = new Map(current.map((row) => [String(row.product_key), row]));
	const diff: ProductDiff = { added: [], removed: [], changed: [], unchanged: [], changes: [] };

	for (const [productKey, row] of currentByKey) {
		const oldRow = previousByKey.get(productKey);
		if (!oldRow) {
			diff.added.push(productKey);
			diff.changes.push({ change_type: 'added', product_key: productKey });
			continue;
		}

		if (String(oldRow.content_hash ?? '') === String(row.content_hash ?? '') && row.content_hash !== undefined) {
			diff.unchanged.push(productKey);
			continue;
		}

		const fieldChanges = changedFields(oldRow, row);
		if (fieldChanges.length === 0) {
			diff.unchanged.push(productKey);
			continue;
		}
		diff.changed.push(productKey);
		diff.changes.push(
			...fieldChanges.map((change) => ({ change_type: 'changed' as const, product_key: productKey, ...change })),
		);
	}

	for (const [productKey] of previousByKey) {
		if (!currentByKey.has(productKey)) {
			diff.removed.push(productKey);
			diff.changes.push({ change_type: 'removed', product_key: productKey });
		}
	}

	return diff;
};

export const assertPublishAllowed = (
	diff: ProductDiff,
	current: Record<string, unknown>[],
	recipe: WebRobotRecipe,
): void => {
	if (current.length < recipe.publish.minItems) {
		throw new Error(
			`Refusing to publish ${current.length} products: the recipe requires at least ${recipe.publish.minItems}`,
		);
	}

	const previousCount = diff.removed.length + diff.changed.length + diff.unchanged.length;
	if (previousCount === 0) {
		return;
	}

	const removedPercent = (diff.removed.length / previousCount) * 100;
	if (removedPercent > recipe.publish.maxRemovedPercent) {
		throw new Error(
			`Refusing to publish because ${removedPercent.toFixed(1)}% of products would be removed, above the ${recipe.publish.maxRemovedPercent}% limit`,
		);
	}
};

const changedFields = (
	oldRow: Record<string, unknown>,
	newRow: Record<string, unknown>,
): Array<{ field: string; old_value: unknown; new_value: unknown }> => {
	const fields = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
	return [...fields]
		.filter((field) => !DIFF_IGNORED_FIELDS.has(field))
		.flatMap((field) => {
			const oldValue = oldRow[field];
			const newValue = newRow[field];
			return stableEquals(oldValue, newValue)
				? []
				: [{ field, old_value: oldValue ?? null, new_value: newValue ?? null }];
		});
};

const stableEquals = (left: unknown, right: unknown): boolean => stableStringify(left) === stableStringify(right);

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
	return JSON.stringify(value ?? null);
};
