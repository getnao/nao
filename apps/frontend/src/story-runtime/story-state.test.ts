import { MAX_STORY_STATE_VALUE_BYTES } from '@nao/shared/story-app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initStoryState, readStoryState, writeStoryState } from './story-state';

describe('story state', () => {
	const persist = vi.fn();

	beforeEach(() => {
		persist.mockReset();
		initStoryState({ shared: {}, own: {} }, persist);
	});

	it('reads an inherited object property name as an absent key', () => {
		expect(readStoryState('constructor', false)).toBeUndefined();
	});

	it('keeps personal and shared values apart under the same key', () => {
		writeStoryState('score', 1, false);
		writeStoryState('score', 9, true);

		expect(readStoryState('score', false)).toBe(1);
		expect(readStoryState('score', true)).toBe(9);
		expect(persist).toHaveBeenLastCalledWith({ key: 'score', value: 9, shared: true });
	});

	it('rejects a key the host would refuse to save', () => {
		expect(() => writeStoryState('bad key', 1, false)).toThrow('not a valid state key');
		expect(persist).not.toHaveBeenCalled();
	});

	it('rejects a value too large to save', () => {
		expect(() => writeStoryState('notes', 'x'.repeat(MAX_STORY_STATE_VALUE_BYTES), false)).toThrow(
			'may not exceed',
		);
		expect(readStoryState('notes', false)).toBeUndefined();
	});
});
