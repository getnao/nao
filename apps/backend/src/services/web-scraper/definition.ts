import { createHash } from 'node:crypto';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

export const webRobotDefinitionHash = (recipe: WebRobotRecipe): string => {
	return createHash('sha256').update(stableStringify(recipe)).digest('hex');
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
	return JSON.stringify(value ?? null);
};
