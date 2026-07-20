import { describe, expect, it } from 'vitest';

import { resolvePieTooltipLabel } from './charts.utils';

describe('resolvePieTooltipLabel', () => {
	it('returns the slice category name from the payload', () => {
		expect(resolvePieTooltipLabel([{ name: 'US' }])).toBe('US');
	});

	it('uses only the first (hovered) slice', () => {
		expect(resolvePieTooltipLabel([{ name: 'FR' }, { name: 'DE' }])).toBe('FR');
	});

	it('coerces non-string names to a string', () => {
		expect(resolvePieTooltipLabel([{ name: 2024 }])).toBe('2024');
	});

	it('returns an empty string instead of "undefined" when the name is missing', () => {
		expect(resolvePieTooltipLabel([{}])).toBe('');
	});

	it('returns an empty string for an empty or missing payload', () => {
		expect(resolvePieTooltipLabel([])).toBe('');
		expect(resolvePieTooltipLabel(undefined)).toBe('');
	});
});
