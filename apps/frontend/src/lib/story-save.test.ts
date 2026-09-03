import { describe, expect, it, vi } from 'vitest';
import { saveStoryCodeIfChanged } from './story-save';

describe('saveStoryCodeIfChanged', () => {
	it('does not persist unchanged code', async () => {
		const persist = vi.fn(async () => {});

		const result = await saveStoryCodeIfChanged({
			baselineCode: '# Story',
			code: '# Story',
			persist,
		});

		expect(result).toBe('unchanged');
		expect(persist).not.toHaveBeenCalled();
	});

	it('reports a failed persistence without treating it as saved', async () => {
		const persist = vi.fn(async () => {
			throw new Error('save failed');
		});

		const result = await saveStoryCodeIfChanged({
			baselineCode: '# Story',
			code: '# Updated Story',
			persist,
		});

		expect(result).toBe('failed');
		expect(persist).toHaveBeenCalledOnce();
	});
});
