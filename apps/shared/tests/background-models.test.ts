import { describe, expect, it } from 'vitest';

import {
	BACKGROUND_MODEL_CATEGORIES,
	setBackgroundModelForCategory,
	setBackgroundModelMode,
	setDefaultChatModel,
	setSingleBackgroundModel,
} from '../src/background-models';

const chat = { provider: 'openai' as const, modelId: 'gpt-5' };
const single = { provider: 'anthropic' as const, modelId: 'claude-sonnet' };

describe('setBackgroundModelMode', () => {
	it('preserves a single model across every category when switching to per-category defaults', () => {
		const settings = setBackgroundModelMode({ mode: 'single', single }, 'perCategory');

		expect(settings.mode).toBe('perCategory');
		expect(settings.single).toEqual(single);
		expect(settings.categories).toEqual(
			Object.fromEntries(BACKGROUND_MODEL_CATEGORIES.map((category) => [category, single])),
		);
	});

	it('keeps the chat default when switching modes', () => {
		expect(setBackgroundModelMode({ mode: 'single', chat, single }, 'perCategory').chat).toEqual(chat);
	});
});

describe('setDefaultChatModel', () => {
	it('pins the chat model without touching background defaults', () => {
		const settings = setDefaultChatModel({ mode: 'perCategory', categories: { title: single } }, chat);

		expect(settings).toEqual({ mode: 'perCategory', chat, single: undefined, categories: { title: single } });
	});

	it('clears the chat model and starts from the single mode when nothing was configured', () => {
		expect(setDefaultChatModel(null, null)).toEqual({
			mode: 'single',
			chat: undefined,
			single: undefined,
			categories: undefined,
		});
	});
});

describe('background model setters', () => {
	it('keep the chat default when pinning a single or per-category model', () => {
		expect(setSingleBackgroundModel({ mode: 'single', chat }, single).chat).toEqual(chat);
		expect(setBackgroundModelForCategory({ mode: 'single', chat }, 'title', single).chat).toEqual(chat);
	});
});
