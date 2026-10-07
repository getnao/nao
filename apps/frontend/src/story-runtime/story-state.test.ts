import { MAX_STORY_STATE_VALUE_BYTES } from '@nao/shared/story-app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initStoryState, readStoryState, writeStoryState } from './story-state';

describe('story state', () => {
	const persist = vi.fn();

	beforeEach(() => {
		persist.mockReset();
		initStoryState({}, persist);
	});

	it('reads an inherited object property name as an absent key', () => {
		expect(readStoryState('constructor')).toBeUndefined();
	});

	it('rejects a key the host would refuse to save', () => {
		expect(() => writeStoryState('bad key', 1)).toThrow('not a valid state key');
		expect(persist).not.toHaveBeenCalled();
	});

	it('rejects a value too large to save', () => {
		expect(() => writeStoryState('notes', 'x'.repeat(MAX_STORY_STATE_VALUE_BYTES))).toThrow('may not exceed');
		expect(readStoryState('notes')).toBeUndefined();
	});
});
