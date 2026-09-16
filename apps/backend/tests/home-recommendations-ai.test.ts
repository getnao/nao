import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrecencyCandidate } from '../src/services/frecency';
import type { HomeRecommendation, HydratedCandidate } from '../src/services/home-recommendations';
import { refineRecommendationsWithAi } from '../src/services/home-recommendations-ai';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
	getProjectModelProvider: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText: mocks.generateText,
}));

vi.mock('../src/utils/llm', () => ({
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectModelProvider: mocks.getProjectModelProvider,
}));

vi.mock('../src/agents/providers', () => ({
	disableModelReasoning: (_provider: string, model: unknown) => model,
	getProviderMeta: () => ({ extractorModelId: 'small-model' }),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function candidate(id: string, kind: 'chat' | 'story' = 'story'): HydratedCandidate {
	const item: HomeRecommendation = {
		kind,
		id,
		shareId: null,
		isOwn: true,
		title: `Title ${id}`,
		authorName: 'me',
		createdAt: new Date('2026-09-01T00:00:00Z'),
		reason: `frecency reason ${id}`,
		score: 1,
	};
	const stats: FrecencyCandidate = {
		assetType: kind,
		assetId: id,
		shareId: null,
		score: 1,
		visitCount: 4,
		visitsLastWeek: 2,
		lastVisitedDaysAgo: 0.5,
		peakHour: 9,
		peakHourShare: 0.75,
		weekdayHistogram: [0, 1, 1, 1, 1, 0, 0],
		reason: `frecency reason ${id}`,
	};
	return { item, stats };
}

function baseInput(overrides: Partial<Parameters<typeof refineRecommendationsWithAi>[0]> = {}) {
	return {
		userId: `user-${Math.random()}`,
		projectId: 'project',
		candidates: [candidate('a'), candidate('b'), candidate('c', 'chat')],
		localNow: 'Wednesday 9am',
		limit: 2,
		...overrides,
	};
}

describe('refineRecommendationsWithAi', () => {
	beforeEach(() => {
		mocks.generateText.mockReset();
		mocks.resolveDefaultModelSelection.mockResolvedValue({ provider: 'openai', modelId: 'small-model' });
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'small-model' }, providerOptions: {} });
	});

	it('skips the model when there is nothing to choose between', async () => {
		expect(await refineRecommendationsWithAi(baseInput({ candidates: [candidate('a')] }))).toBeNull();
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('returns null when no model is configured', async () => {
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.getProjectModelProvider.mockResolvedValue(undefined);
		expect(await refineRecommendationsWithAi(baseInput())).toBeNull();
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('maps picks back to candidates, cleans reasons and tops up from the frecency order', async () => {
		mocks.generateText.mockResolvedValue({
			output: {
				picks: [
					{ candidate: 3, reason: '  "Your weekday morning check-in."  ' },
					{ candidate: 3, reason: 'duplicate' },
					{ candidate: 42, reason: 'unknown' },
					{ candidate: 1, reason: '' },
				],
			},
		});

		const result = await refineRecommendationsWithAi(baseInput({ limit: 3 }));

		expect(result?.map((item) => [item.id, item.reason])).toEqual([
			['c', 'Your weekday morning check-in'],
			['a', 'frecency reason a'],
			['b', 'frecency reason b'],
		]);

		const call = mocks.generateText.mock.calls[0][0];
		expect(call.messages[0].content).toContain('Current local time: Wednesday 9am.');
		expect(call.messages[0].content).toContain('3. [chat] "Title c"');
		expect(call.messages[0].content).toContain('usual hour: 9am (75% of opens)');
	});

	it('caches the answer for the same user, moment and shortlist', async () => {
		mocks.generateText.mockResolvedValue({ output: { picks: [{ candidate: 2, reason: 'Second' }] } });
		const input = baseInput();

		const first = await refineRecommendationsWithAi(input);
		const second = await refineRecommendationsWithAi(input);

		expect(first?.map((item) => item.id)).toEqual(['b', 'a']);
		expect(second).toEqual(first);
		expect(mocks.generateText).toHaveBeenCalledTimes(1);

		await refineRecommendationsWithAi({ ...input, localNow: 'Wednesday 10am' });
		expect(mocks.generateText).toHaveBeenCalledTimes(2);
	});

	it('falls back to null when the model call fails and remembers the failure briefly', async () => {
		mocks.generateText.mockRejectedValue(new Error('boom'));
		const input = baseInput();

		expect(await refineRecommendationsWithAi(input)).toBeNull();
		expect(await refineRecommendationsWithAi(input)).toBeNull();
		expect(mocks.generateText).toHaveBeenCalledTimes(1);
	});
});
