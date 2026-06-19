import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	completeRun: vi.fn(),
	createRun: vi.fn(),
	failRun: vi.fn(),
	getChat: vi.fn(),
	getChatTokenTotals: vi.fn(),
	getConfig: vi.fn(),
	getDismissedFingerprints: vi.fn(),
	getFirstProjectAdminUserId: vi.fn(),
	getReconcilableRecommendations: vi.fn(),
	getWindowTotals: vi.fn(),
	createChat: vi.fn(),
	projectById: vi.fn(),
	resolveModelSelection: vi.fn(),
	createAgent: vi.fn(),
	setRunChat: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ai')>();
	return {
		...actual,
		readUIMessageStream: vi.fn(async function* () {}),
	};
});

vi.mock('../src/db/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () => ({
						limit: () => ({
							execute: vi.fn(async () => []),
						}),
					}),
				}),
			}),
		}),
		transaction: mocks.transaction,
	},
}));

vi.mock('../src/queries/context-recommendation.queries', () => ({
	completeRun: mocks.completeRun,
	createRun: mocks.createRun,
	failRun: mocks.failRun,
	getChatTokenTotals: mocks.getChatTokenTotals,
	getConfig: mocks.getConfig,
	getDismissedFingerprints: mocks.getDismissedFingerprints,
	getFirstProjectAdminUserId: mocks.getFirstProjectAdminUserId,
	getReconcilableRecommendations: mocks.getReconcilableRecommendations,
	getWindowTotals: mocks.getWindowTotals,
	setRunChat: mocks.setRunChat,
}));

vi.mock('../src/queries/chat.queries', () => ({
	createChat: mocks.createChat,
	getChat: mocks.getChat,
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.projectById,
}));

vi.mock('../src/services/agent', () => ({
	agentService: {
		resolveModelSelection: mocks.resolveModelSelection,
		create: mocks.createAgent,
	},
}));

vi.mock('../src/services/context-pr.service', () => ({
	autoCreateRecommendationPullRequests: vi.fn(),
	resolveRecommendationRepo: vi.fn(async () => null),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runContextRecommendations } from '../src/services/context-recommendations.service';

describe('context recommendations service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getConfig.mockResolvedValue(null);
		mocks.resolveModelSelection.mockResolvedValue({ provider: 'openai', modelId: 'gpt-test' });
		mocks.createRun.mockResolvedValue({ id: 'run-1' });
		mocks.projectById.mockResolvedValue({ id: 'project-1', path: null });
		mocks.getReconcilableRecommendations.mockResolvedValue([]);
		mocks.getDismissedFingerprints.mockResolvedValue([]);
		mocks.getWindowTotals.mockResolvedValue({ errors: 0, downvotes: 0, regenerations: 0 });
		mocks.getFirstProjectAdminUserId.mockResolvedValue('user-1');
		mocks.createChat.mockResolvedValue([{ id: 'chat-1' }, { id: 'message-1' }]);
		mocks.getChat.mockResolvedValue([
			{
				id: 'chat-1',
				projectId: 'project-1',
				title: 'Context recommendations run',
				isStarred: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messages: [],
			},
			'user-1',
		]);
		mocks.createAgent.mockResolvedValue({ stream: vi.fn(() => new ReadableStream()) });
		mocks.getChatTokenTotals.mockResolvedValue({});
		mocks.transaction.mockImplementation(async (callback) => callback({}));
	});

	it('creates the analysis chat with the context recommendation source', async () => {
		await runContextRecommendations('project-1', { trigger: 'manual' });

		expect(mocks.createChat).toHaveBeenCalledWith(
			{ title: 'Context recommendations run', userId: 'user-1', projectId: 'project-1' },
			expect.objectContaining({ source: 'context_recommendation' }),
		);
		expect(mocks.setRunChat).toHaveBeenCalledWith('run-1', 'chat-1');
	});
});
