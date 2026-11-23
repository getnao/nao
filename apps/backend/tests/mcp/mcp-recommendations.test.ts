import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	listRecommendations: vi.fn(),
	getRecommendationById: vi.fn(),
	setRecommendationStatus: vi.fn(),
	listFeedbacksForRecommendations: vi.fn(),
	resolveRecommendationRepo: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/queries/context-recommendation.queries', () => ({
	listRecommendations: mocks.listRecommendations,
	getRecommendationById: mocks.getRecommendationById,
	setRecommendationStatus: mocks.setRecommendationStatus,
	listFeedbacksForRecommendations: mocks.listFeedbacksForRecommendations,
}));
vi.mock('../../src/services/context-pr.service', () => ({
	resolveRecommendationRepo: mocks.resolveRecommendationRepo,
}));
vi.mock('../../src/services/context-recommendations.service', () => ({
	repairRecommendationTriggerRefs: async (_projectId: string, items: unknown[]) => items,
}));

import { env } from '../../src/env';
import { BASELINE_TOOL, listToolNames, useContextAdminMcpClient } from '../helpers/context-admin-mcp-client';
import { createRecommendation as recommendation } from '../helpers/context-recommendation';

const RECOMMENDATION_TOOLS = ['list_recommendations', 'get_recommendation', 'set_recommendation_status'];

const connect = useContextAdminMcpClient();

beforeEach(() => {
	env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = true;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('MCP recommendation tools registration', () => {
	it.each<McpUserRole>(['admin', 'context_admin'])('exposes them to %s', async (role) => {
		const client = await connect(role);

		expect(await listToolNames(client)).toEqual(expect.arrayContaining(RECOMMENDATION_TOOLS));
	});

	it('hides them from regular users', async () => {
		const client = await connect('user');

		expect(await listToolNames(client)).toEqual([BASELINE_TOOL]);
	});

	it('hides them when context recommendations are disabled on the instance', async () => {
		env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = false;
		const client = await connect('admin');

		const names = await listToolNames(client);
		expect(names).toContain('search_chats');
		expect(names).not.toContain('list_recommendations');
	});
});

describe('MCP list_recommendations', () => {
	it('returns summaries of the requested category with the count per category', async () => {
		mocks.listRecommendations.mockResolvedValue([
			recommendation({ id: 'rec-1', category: 'tool_error' }),
			recommendation({ id: 'rec-2', category: 'hallucination' }),
			recommendation({ id: 'rec-3', category: 'tool_error' }),
		]);
		const client = await connect('admin');

		const result = await client.callTool({
			name: 'list_recommendations',
			arguments: { status: 'open', category: 'tool_error' },
		});

		expect(mocks.listRecommendations).toHaveBeenCalledWith('project-1', 'open');
		const output = result.structuredContent as {
			recommendations: Array<{ id: string; categoryLabel: string; affectedChats: number }>;
			categories: Array<{ category: string; count: number }>;
		};
		expect(output.recommendations.map(({ id }) => id)).toEqual(['rec-1', 'rec-3']);
		expect(output.recommendations[0]).toMatchObject({ categoryLabel: 'Tool errors', affectedChats: 4 });
		expect(output.categories).toEqual(
			expect.arrayContaining([
				{ category: 'tool_error', label: 'Tool errors', count: 2 },
				{ category: 'hallucination', label: 'Hallucinations', count: 1 },
				{ category: 'other', label: 'Other', count: 0 },
			]),
		);
	});
});

describe('MCP get_recommendation', () => {
	it('returns the full fix with linked feedback and a prompt to apply it', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation({ id: 'rec-1' }));
		mocks.listFeedbacksForRecommendations.mockResolvedValue([
			{
				recommendationId: 'rec-1',
				messageId: 'message-1',
				chatId: 'chat-1',
				vote: 'down',
				explanation: 'Wrong revenue',
				userName: 'Alice',
			},
		]);
		mocks.resolveRecommendationRepo.mockResolvedValue({ subPath: 'context' });
		const client = await connect('context_admin');

		const result = await client.callTool({ name: 'get_recommendation', arguments: { recommendation_id: 'rec-1' } });

		expect(mocks.getRecommendationById).toHaveBeenCalledWith('project-1', 'rec-1');
		expect(result.structuredContent).toMatchObject({
			id: 'rec-1',
			rootCause: 'RULES.md does not say revenue excludes refunds.',
			insights: [{ signalType: 'downvote_theme', triggerRefs: [{ chatId: 'chat-1' }] }],
			proposedEdits: [{ path: 'RULES.md', kind: 'edit' }],
			feedbacks: [{ chatId: 'chat-1', vote: 'down', explanation: 'Wrong revenue', userName: 'Alice' }],
		});
		const agentPrompt = (result.structuredContent as { agentPrompt: string }).agentPrompt;
		expect(agentPrompt).toContain('## Exclude refunds from revenue');
		expect(agentPrompt).toContain('context/RULES.md');
	});

	it('refuses a recommendation that is not in the project', async () => {
		mocks.getRecommendationById.mockResolvedValue(null);
		const client = await connect('admin');

		const result = await client.callTool({ name: 'get_recommendation', arguments: { recommendation_id: 'rec-9' } });

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('Recommendation rec-9 not found in this project.');
	});
});

describe('MCP set_recommendation_status', () => {
	it('marks a recommendation as applied on behalf of the caller', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation({ id: 'rec-1' }));
		const client = await connect('admin');

		const result = await client.callTool({
			name: 'set_recommendation_status',
			arguments: { recommendation_id: 'rec-1', status: 'applied' },
		});

		expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
			id: 'rec-1',
			projectId: 'project-1',
			status: 'applied',
			userId: 'user-1',
		});
		expect(result.structuredContent).toEqual({ id: 'rec-1', status: 'applied' });
	});

	it('does not touch a recommendation from another project', async () => {
		mocks.getRecommendationById.mockResolvedValue(null);
		const client = await connect('admin');

		const result = await client.callTool({
			name: 'set_recommendation_status',
			arguments: { recommendation_id: 'rec-9', status: 'applied' },
		});

		expect(result.isError).toBe(true);
		expect(mocks.setRecommendationStatus).not.toHaveBeenCalled();
	});
});
