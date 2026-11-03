import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleChatConfig } from '../src/queries/project-google-chat-config.queries';
import { parseGoogleChatServiceAccountKey } from '../src/queries/project-google-chat-config.queries';
import { googleChatService } from '../src/services/google-chat';

type MentionHandler = (
	thread: { id: string; post: ReturnType<typeof vi.fn> },
	message: { raw: unknown; text: string; author: { isBot: boolean } },
) => Promise<void>;

type ActionHandler = (event: { threadId: string; raw: unknown }) => Promise<void>;

const harness = vi.hoisted(() => ({
	actionHandlers: new Map<string, ActionHandler>(),
	adapterConfigs: [] as unknown[],
	agentStop: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	createAgent: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	generateChartImage: vi.fn(),
	generateKpiCardImage: vi.fn(),
	getChatByGoogleChatThread: vi.fn(),
	getLastAssistantMessageId: vi.fn(),
	getUser: vi.fn(),
	mentionHandlers: [] as MentionHandler[],
	projectRole: vi.fn(),
	upsertFeedback: vi.fn(),
	upsertMessage: vi.fn(),
}));

vi.mock('@chat-adapter/gchat', () => ({
	createGoogleChatAdapter: vi.fn((config: unknown) => {
		harness.adapterConfigs.push(config);
		return {};
	}),
}));

vi.mock('@chat-adapter/state-memory', () => ({
	createMemoryState: vi.fn(() => ({})),
}));

vi.mock('chat', () => ({
	Card: vi.fn(),
	Chat: class {
		webhooks = { gchat: vi.fn() };

		onAction(actionId: string, handler: ActionHandler): void {
			harness.actionHandlers.set(actionId, handler);
		}

		onNewMention(handler: MentionHandler): void {
			harness.mentionHandlers.push(handler);
		}
	},
}));

vi.mock('../src/components/generate-chart', () => ({
	generateChartImage: harness.generateChartImage,
}));
vi.mock('../src/components/generate-kpi-card', () => ({
	generateKpiCardImage: harness.generateKpiCardImage,
}));
vi.mock('../src/queries/chart-image', () => ({
	saveChart: vi.fn(async () => 'chart-image-id'),
}));
vi.mock('../src/queries/chat.queries', () => ({
	createChat: harness.createChat,
	getChat: harness.getChat,
	getChatByGoogleChatThread: harness.getChatByGoogleChatThread,
	getLastAssistantMessageId: harness.getLastAssistantMessageId,
	upsertMessage: harness.upsertMessage,
}));
vi.mock('../src/queries/feedback.queries', () => ({
	upsertFeedback: harness.upsertFeedback,
}));
vi.mock('../src/queries/project.queries', () => ({
	getDisplaySettings: vi.fn(async () => ({ dateFormat: undefined })),
	getUserRoleInProject: harness.projectRole,
}));
vi.mock('../src/queries/user.queries', () => ({
	getUser: harness.getUser,
}));
vi.mock('../src/services/agent', () => ({
	agentService: { create: harness.createAgent, get: vi.fn(() => ({ stop: harness.agentStop })) },
}));
vi.mock('../src/services/branding.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/branding.service')>()),
	getAppName: vi.fn(async () => 'nao'),
}));
vi.mock('../src/services/google-chat-answer', () => ({
	GoogleChatAnswer: {
		start: vi.fn(async () => ({
			appendText: vi.fn(),
			abandon: vi.fn(),
			finish: vi.fn(),
			retire: vi.fn(),
		})),
	},
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: harness.assertProjectCloudBillingAccess,
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));
vi.mock('../src/utils/messaging-provider', () => ({
	EXCLUDED_TOOLS: [],
	escapeMarkdownText: vi.fn((text: string) => text),
	formatMessagingError: vi.fn(() => 'processing failed'),
	getMessagingProviderWebhookUrl: vi.fn(
		(baseUrl: string, provider: string, projectId: string) => `${baseUrl}api/webhooks/${provider}/${projectId}`,
	),
}));

const PROJECT_A: GoogleChatConfig = {
	projectId: 'project-a',
	credentials: { client_email: 'bot-a@example.iam.gserviceaccount.com', private_key: 'key-a' },
	googleCloudProjectNumber: '111',
	redirectUrl: 'https://a.example/',
};

const PROJECT_B: GoogleChatConfig = {
	projectId: 'project-b',
	credentials: { client_email: 'bot-b@example.iam.gserviceaccount.com', private_key: 'key-b' },
	redirectUrl: 'https://b.example/',
};

function createThread() {
	return { id: 'gchat:spaces/AAA:threads/BBB', post: vi.fn(async () => ({ edit: vi.fn() })) };
}

function createButtonClick(email: string, space: { name: string; type?: string; spaceType?: string }) {
	return {
		threadId: `gchat:${space.name}:dGhyZWFk`,
		raw: { chat: { buttonClickedPayload: { user: { email }, space } } },
	};
}

function createMention(email: string | undefined, text = '@nao how many orders?') {
	return {
		text,
		author: { isBot: false },
		raw: { chat: { user: { email }, messagePayload: { message: { sender: { email } } } } },
	};
}

describe('GoogleChatService', () => {
	beforeEach(() => {
		(googleChatService as unknown as { _bots: Map<string, unknown> })._bots.clear();
		harness.actionHandlers.clear();
		harness.adapterConfigs.length = 0;
		harness.agentStop.mockReset();
		harness.getLastAssistantMessageId.mockReset().mockResolvedValue('assistant-message-id');
		harness.upsertFeedback.mockReset();
		harness.mentionHandlers.length = 0;
		harness.assertProjectCloudBillingAccess.mockReset().mockResolvedValue(undefined);
		harness.createAgent.mockReset().mockRejectedValue(new Error('stop after agent creation'));
		harness.createChat.mockReset().mockResolvedValue([{ id: 'chat-id' }]);
		harness.getChat.mockReset().mockResolvedValue([{ id: 'chat-id', messages: [] }]);
		harness.getChatByGoogleChatThread.mockReset().mockResolvedValue(null);
		harness.getUser.mockReset().mockResolvedValue({ id: 'user-id' });
		harness.projectRole.mockReset().mockResolvedValue('user');
		harness.upsertMessage.mockReset();
	});

	it('verifies webhooks against the project endpoint URL and Google Cloud project number', () => {
		googleChatService.getWebhooks(PROJECT_A);

		expect(harness.adapterConfigs[0]).toMatchObject({
			credentials: PROJECT_A.credentials,
			endpointUrl: 'https://a.example/api/webhooks/google-chat/project-a',
			googleChatProjectNumber: '111',
			workspaceAddOnServiceAccountEmail: 'service-111@gcp-sa-gsuiteaddons.iam.gserviceaccount.com',
		});
	});

	it('keeps one bot per project and reuses it while the configuration is unchanged', () => {
		googleChatService.getWebhooks(PROJECT_A);
		googleChatService.getWebhooks(PROJECT_B);
		googleChatService.getWebhooks(PROJECT_A);

		expect(harness.adapterConfigs).toHaveLength(2);
		expect(harness.mentionHandlers).toHaveLength(2);
	});

	it('answers as the nao user matching the sender email, without the bot mention', async () => {
		googleChatService.getWebhooks(PROJECT_A);
		const thread = createThread();

		await harness.mentionHandlers[0](thread, createMention('Analyst@Example.com'));

		expect(harness.getUser).toHaveBeenCalledWith({ email: 'analyst@example.com' });
		expect(harness.projectRole).toHaveBeenCalledWith('project-a', 'user-id');
		expect(harness.getChatByGoogleChatThread).toHaveBeenCalledWith(thread.id, 'project-a');
		expect(harness.createChat).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'project-a', googleChatThreadId: thread.id }),
			{ text: 'how many orders?', source: 'google-chat' },
		);
	});

	it('tells unknown senders how to sign up instead of answering', async () => {
		harness.getUser.mockResolvedValue(null);
		googleChatService.getWebhooks(PROJECT_A);
		const thread = createThread();

		await harness.mentionHandlers[0](thread, createMention('stranger@example.com'));

		expect(thread.post).toHaveBeenCalledWith(expect.stringContaining('stranger@example.com'));
		expect(harness.createChat).not.toHaveBeenCalled();
	});

	it('ignores messages sent by bots', async () => {
		googleChatService.getWebhooks(PROJECT_A);
		const thread = createThread();

		await harness.mentionHandlers[0](thread, { ...createMention('bot@example.com'), author: { isBot: true } });

		expect(thread.post).not.toHaveBeenCalled();
	});
});

describe('GoogleChatService card buttons', () => {
	beforeEach(() => {
		(googleChatService as unknown as { _bots: Map<string, unknown> })._bots.clear();
		harness.actionHandlers.clear();
		harness.agentStop.mockReset();
		harness.getChatByGoogleChatThread.mockReset().mockResolvedValue({ id: 'chat-id' });
		harness.getLastAssistantMessageId.mockReset().mockResolvedValue('assistant-message-id');
		harness.getUser.mockReset().mockResolvedValue({ id: 'user-id' });
		harness.projectRole.mockReset().mockResolvedValue('user');
		harness.upsertFeedback.mockReset();
		googleChatService.getWebhooks(PROJECT_A);
	});

	it('lets a project member stop the answer of the conversation in the same project', async () => {
		const click = createButtonClick('analyst@example.com', { name: 'spaces/AAA', spaceType: 'SPACE' });

		await harness.actionHandlers.get('stop_generation')!(click);

		expect(harness.getChatByGoogleChatThread).toHaveBeenCalledWith(click.threadId, 'project-a');
		expect(harness.agentStop).toHaveBeenCalled();
	});

	it('ignores Stop and feedback clicks from people outside the project', async () => {
		harness.projectRole.mockResolvedValue(null);
		const click = createButtonClick('outsider@example.com', { name: 'spaces/AAA', spaceType: 'SPACE' });

		await harness.actionHandlers.get('stop_generation')!(click);
		await harness.actionHandlers.get('feedback_negative')!(click);

		expect(harness.agentStop).not.toHaveBeenCalled();
		expect(harness.upsertFeedback).not.toHaveBeenCalled();
	});

	it('maps a click in a direct message back to the conversation of the whole DM space', async () => {
		const click = createButtonClick('analyst@example.com', { name: 'spaces/DM1', spaceType: 'DIRECT_MESSAGE' });

		await harness.actionHandlers.get('feedback_positive')!(click);

		expect(harness.getChatByGoogleChatThread).toHaveBeenCalledWith('gchat:spaces/DM1:dm', 'project-a');
		expect(harness.upsertFeedback).toHaveBeenCalledWith({ messageId: 'assistant-message-id', vote: 'up' });
	});
});

describe('parseGoogleChatServiceAccountKey', () => {
	it('extracts the credentials from a service account JSON key', () => {
		const key = JSON.stringify({
			type: 'service_account',
			client_email: 'bot@example.iam.gserviceaccount.com',
			private_key: 'private-key',
			project_id: 'my-project',
		});

		expect(parseGoogleChatServiceAccountKey(key)).toEqual({
			client_email: 'bot@example.iam.gserviceaccount.com',
			private_key: 'private-key',
			project_id: 'my-project',
		});
	});

	it.each([
		'',
		'not json',
		JSON.stringify({ client_email: 'bot@example.com' }),
		JSON.stringify({ client_email: ' ', private_key: 'private-key' }),
		JSON.stringify({ client_email: 'bot@example.com', private_key: '' }),
	])('rejects %j', (key) => {
		expect(parseGoogleChatServiceAccountKey(key)).toBeNull();
	});
});

describe('GoogleChatService charts', () => {
	type ChartPart = Record<string, unknown>;
	type ChartAnswer = { addImage: ReturnType<typeof vi.fn>; appendText: ReturnType<typeof vi.fn> };
	type ChartService = {
		_rememberEarlierQueryResults(chat: { messages: { parts: unknown[] }[] }, state: unknown): void;
		_handleChartPart(part: ChartPart, state: unknown, ctx: unknown, answer: ChartAnswer): Promise<void>;
	};

	const service = googleChatService as unknown as ChartService;
	const ctx = { chatId: 'chat-id', config: PROJECT_A };

	function createState() {
		return { renderedToolCallIds: new Set<string>(), sqlOutputs: new Map(), toolGroup: new Map() };
	}

	function createAnswer(): ChartAnswer {
		return { addImage: vi.fn(), appendText: vi.fn() };
	}

	function chartPart(input: Record<string, unknown>): ChartPart {
		return {
			type: 'tool-display_chart',
			state: 'output-available',
			toolCallId: `chart-${Math.random()}`,
			input: { query_id: 'query-1', ...input },
			output: { success: true },
		};
	}

	const earlierQuery = {
		type: 'tool-execute_sql',
		state: 'output-available',
		input: { name: 'Orders by month' },
		output: { id: 'query-1', data: [{ month: '2018-01-01', orders: 29 }] },
	};

	beforeEach(() => {
		harness.generateChartImage.mockReset().mockReturnValue(Buffer.from('png'));
		harness.generateKpiCardImage.mockReset().mockReturnValue(Buffer.from('png'));
	});

	it('draws a chart of a query that ran earlier in the conversation', async () => {
		const state = createState();
		const answer = createAnswer();
		service._rememberEarlierQueryResults({ messages: [{ parts: [earlierQuery] }] }, state);

		await service._handleChartPart(
			chartPart({ chart_type: 'bar', x_axis_key: 'month', series: [{ data_key: 'orders' }] }),
			state,
			ctx,
			answer,
		);

		expect(harness.generateChartImage).toHaveBeenCalledWith(
			expect.objectContaining({ data: earlierQuery.output.data, width: 560, height: 360 }),
		);
		expect(answer.addImage).toHaveBeenCalledWith('https://a.example/c/chat-id/chart-image-id.png');
	});

	it('draws a KPI card with its own renderer, which the chart renderer cannot draw', async () => {
		const state = createState();
		const answer = createAnswer();
		const rows = [{ orders: 1234 }];
		service._rememberEarlierQueryResults(
			{ messages: [{ parts: [{ ...earlierQuery, output: { id: 'query-1', data: rows } }] }] },
			state,
		);

		await service._handleChartPart(
			chartPart({ chart_type: 'kpi_card', series: [{ data_key: 'orders', label: 'Orders' }] }),
			state,
			ctx,
			answer,
		);

		expect(harness.generateChartImage).not.toHaveBeenCalled();
		expect(harness.generateKpiCardImage).toHaveBeenCalledWith(expect.objectContaining({ rows, width: 560 }));
		expect(answer.addImage).toHaveBeenCalledWith('https://a.example/c/chat-id/chart-image-id.png');
	});

	it('links to the chart in nao when it cannot be drawn', async () => {
		harness.generateChartImage.mockImplementation(() => {
			throw new Error('Recharts did not render SVG content');
		});
		const state = createState();
		const answer = createAnswer();
		service._rememberEarlierQueryResults({ messages: [{ parts: [earlierQuery] }] }, state);

		await service._handleChartPart(
			chartPart({ chart_type: 'bar', title: 'Orders', x_axis_key: 'month', series: [{ data_key: 'orders' }] }),
			state,
			ctx,
			answer,
		);

		expect(answer.addImage).not.toHaveBeenCalled();
		expect(answer.appendText).toHaveBeenCalledWith(
			'📊 **Orders**: [view the chart in nao](https://a.example/chat-id)',
		);
	});
});
