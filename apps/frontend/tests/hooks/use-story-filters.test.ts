import { describe, expect, it, vi } from 'vitest';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import { applyStoryFilterSelection } from '@/hooks/use-story-filters';

vi.mock('@/main', () => ({ trpc: {} }));

const FILTERS: ParsedFilterBlock[] = [
	{ id: 'country', label: 'Country', filterType: 'select' },
	{ id: 'city', label: 'City', filterType: 'multi_select', dependsOn: 'country' },
	{ id: 'district', label: 'District', filterType: 'select', dependsOn: 'city' },
	{ id: 'channel', label: 'Channel', filterType: 'select' },
];

describe('applyStoryFilterSelection', () => {
	it('clears the filters cascading from a changed parent in the same update', () => {
		const selections = { country: 'FR', city: ['Paris'], district: '75001', channel: 'web' };

		expect(applyStoryFilterSelection(selections, 'country', 'DE', FILTERS)).toEqual({
			country: 'DE',
			channel: 'web',
		});
	});

	it('keeps dependent selections when the parent value does not change', () => {
		const selections = { country: 'FR', city: ['Paris'] };

		expect(applyStoryFilterSelection(selections, 'country', 'FR', FILTERS)).toEqual(selections);
	});

	it('removes an emptied selection and its dependents', () => {
		const selections = { country: 'FR', city: ['Paris'], district: '75001' };

		expect(applyStoryFilterSelection(selections, 'city', [], FILTERS)).toEqual({ country: 'FR' });
	});
});
