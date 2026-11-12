import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('@slack/web-api', () => ({ WebClient: class {} }));
vi.mock('../../src/queries/project.queries', () => ({ getDisplaySettings: vi.fn(async () => ({ dateFormat: null })) }));
vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ProjectSlackBot } from '../../src/services/slack';
import type { UIMessagePart } from '../../src/types/chat';
import type { ConversationContext, StreamState } from '../../src/types/messaging-provider';

function createBot(): ProjectSlackBot {
	const bot = new ProjectSlackBot({
		projectId: 'project-1',
		botToken: 'xoxb-test',
		signingSecret: 'secret',
		redirectUrl: 'https://nao.example.com/',
		autoCreateUsersEnabled: false,
		autoCreateUsersDomains: [],
		transportMode: 'socket',
		appToken: 'xapp-test',
		replyMode: 'thread',
		dmScopeMissing: false,
		dmThreadsEnabled: false,
	});
	bot['_editConversationCard'] = vi.fn(async () => {});
	return bot;
}

function createState(): StreamState {
	return {
		renderedToolCallIds: new Set(),
		sqlOutputs: new Map(),
		lastUpdateAt: 0,
		toolGroup: new Map(),
		toolGroupBlockIndex: -1,
	};
}

function createContext(): ConversationContext {
	return {
		thread: { id: 'slack:C123:1700000000.000100' } as ConversationContext['thread'],
		userMessage: {} as ConversationContext['userMessage'],
		user: null,
		chatId: 'chat-1',
		convMessage: null,
		blocks: [],
		textBlockIndex: -1,
		textBlockCount: 0,
		isNewChat: false,
		modelId: undefined,
		timezone: undefined,
	};
}

function queryPart(toolCallId: string, queryId: string, data: Record<string, unknown>[]): UIMessagePart {
	return {
		type: 'tool-execute_semantic_query',
		toolCallId,
		state: 'output-available',
		input: { name: queryId },
		output: { id: queryId, data },
	} as unknown as UIMessagePart;
}

function chartPart(toolCallId: string, state: 'input-available' | 'output-available', input: object): UIMessagePart {
	return {
		type: 'tool-display_chart',
		toolCallId,
		state,
		input,
		...(state === 'output-available' ? { output: { success: true } } : {}),
	} as unknown as UIMessagePart;
}

const queries = [
	queryPart('q1', 'query_month', [
		{ month: 'jan', orders: 3 },
		{ month: 'feb', orders: 5 },
	]),
	queryPart('q2', 'query_status', [
		{ status: 'completed', orders: 6 },
		{ status: 'returned', orders: 2 },
	]),
];
const lineChart = {
	query_id: 'query_month',
	chart_type: 'line',
	title: 'Orders Over Time',
	x_axis_key: 'month',
	x_axis_type: 'category',
	series: [{ data_key: 'orders' }],
};
const pieChart = {
	query_id: 'query_status',
	chart_type: 'pie',
	title: 'Orders by Status',
	x_axis_key: 'status',
	x_axis_type: 'category',
	series: [{ data_key: 'orders' }],
};

describe('ProjectSlackBot parallel tool results', () => {
	it('renders every chart when parallel calls finish while a sibling is still the last part', async () => {
		const bot = createBot();
		const state = createState();
		const ctx = createContext();
		const handled = new Set<string>();
		const handle = (parts: UIMessagePart[]) => bot['_handleNewToolResults'](parts, handled, state, ctx);

		await handle([
			...queries,
			chartPart('c1', 'output-available', lineChart),
			chartPart('c2', 'input-available', pieChart),
		]);
		await handle([
			...queries,
			chartPart('c1', 'output-available', lineChart),
			chartPart('c2', 'output-available', pieChart),
		]);

		expect(ctx.blocks.map((block) => block.type === 'chart' && block.title)).toEqual([
			'Orders Over Time',
			'Orders by Status',
		]);
	});

	it('handles each tool result once across stream snapshots', async () => {
		const bot = createBot();
		const state = createState();
		const ctx = createContext();
		const handled = new Set<string>();
		const parts = [...queries, chartPart('c1', 'output-available', lineChart)];

		await bot['_handleNewToolResults'](parts, handled, state, ctx);
		await bot['_handleNewToolResults'](parts, handled, state, ctx);

		expect(ctx.blocks).toHaveLength(1);
	});
});
