import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpUserRole } from '../src/types/mcp-endpoint';

const mocks = vi.hoisted(() => ({
	listRecommendations: vi.fn(),
	getRecommendationById: vi.fn(),
	setRecommendationStatus: vi.fn(),
	listFeedbacksForRecommendations: vi.fn(),
	resolveRecommendationRepo: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/queries/context-recommendation.queries', () => ({
	listRecommendations: mocks.listRecommendations,
	getRecommendationById: mocks.getRecommendationById,
	setRecommendationStatus: mocks.setRecommendationStatus,
	listFeedbacksForRecommendations: mocks.listFeedbacksForRecommendations,
}));
vi.mock('../src/services/context-pr.service', () => ({
	resolveRecommendationRepo: mocks.resolveRecommendationRepo,
}));
vi.mock('../src/services/context-recommendations.service', () => ({
	repairRecommendationTriggerRefs: async (_projectId: string, items: unknown[]) => items,
}));

import { env } from '../src/env';
import { registerContextAdminTools } from '../src/mcp/tools/context-admin-tools';

const RECOMMENDATION_TOOLS = ['list_recommendations', 'get_recommendation', 'set_recommendation_status'];

const BASELINE_TOOL = 'baseline';

const connections: Array<{ client: Client; server: McpServer }> = [];

beforeEach(() => {
	env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = true;
});

afterEach(async () => {
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP recommendation tools registration', () => {
	it.each<McpUserRole>(['admin', 'context_admin'])('exposes them to %s', async (role) => {
		const client = await connect(role);

		expect(await toolNames(client)).toEqual(expect.arrayContaining(RECOMMENDATION_TOOLS));
	});

	it('hides them from regular users', async () => {
		const client = await connect('user');

		expect(await toolNames(client)).toEqual([BASELINE_TOOL]);
	});

	it('hides them when context recommendations are disabled on the instance', async () => {
		env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = false;
		const client = await connect('admin');

		const names = await toolNames(client);
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

async function connect(role: McpUserRole): Promise<Client> {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	server.registerTool(
		BASELINE_TOOL,
		{ description: 'Always registered, like the tools of the other modes.' },
		() => ({
			content: [],
		}),
	);
	registerContextAdminTools(server, {
		userId: 'user-1',
		projectId: 'project-1',
		role,
		settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
		chartDataMode: false,
		storyCreationEnabled: true,
		customStoryCreationEnabled: false,
	});
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	connections.push({ client, server });
	return client;
}

async function toolNames(client: Client): Promise<string[]> {
	const { tools } = await client.listTools();
	return tools.map((tool) => tool.name);
}

function recommendation(overrides: Record<string, unknown>) {
	return {
		id: 'rec',
		projectId: 'project-1',
		runId: 'run-1',
		fingerprint: 'fingerprint',
		suggestedFile: 'RULES.md',
		subjectKey: 'revenue',
		status: 'open',
		impactScore: 80,
		impact: { affectedChats: 4, failureShare: 0.5 },
		insights: [
			{ signalType: 'downvote_theme', metric: 'downvotes', count: 3, triggerRefs: [{ chatId: 'chat-1' }] },
		],
		title: 'Exclude refunds from revenue',
		summary: 'Revenue answers include refunded orders.',
		suggestedAction: 'Document that revenue excludes refunds.',
		fixKind: 'patch',
		fixTarget: 'rules',
		category: 'semantic_missing',
		rootCause: 'RULES.md does not say revenue excludes refunds.',
		rootCauseKind: 'context_missing',
		proposedEdits: [
			{
				path: 'RULES.md',
				kind: 'edit',
				oldContent: '# Revenue',
				newContent: '# Revenue\nRevenue excludes refunds.',
			},
		],
		fixGuidance: null,
		fixPrompt: null,
		prUrl: null,
		prBranch: null,
		prCreatedAt: null,
		llmProvider: null,
		llmModelId: null,
		firstSeenAt: new Date('2026-10-01T03:00:00.000Z'),
		lastSeenAt: new Date('2026-10-20T03:00:00.000Z'),
		occurrenceCount: 2,
		statusChangedAt: null,
		statusChangedBy: null,
		createdAt: new Date('2026-10-01T03:00:00.000Z'),
		...overrides,
	};
}
