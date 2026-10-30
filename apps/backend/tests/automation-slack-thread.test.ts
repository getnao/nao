import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAutomationRunPrompt } from '../src/components/ai/automation-run-prompt';
import type { AutomationIntegrationConfig } from '../src/types/automation';
import type { ToolContext } from '../src/types/tools';

// The db module imports bun:sqlite, which is unavailable under the node-based
// vitest runner; stub it so the automation-tools import chain can load.
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/custom-story', () => ({ getActiveThemeForProject: vi.fn(async () => null) }));

vi.mock('../src/queries/project.queries', () => ({
	getDisplaySettings: vi.fn(async () => ({ dateFormat: null })),
}));

vi.mock('../src/components/generate-chart', () => ({
	generateChartImage: vi.fn(() => Buffer.from('png')),
}));

vi.mock('../src/services/query-result.service', () => ({
	getQueryResult: vi.fn(async () => ({ columns: ['a'], data: [{ a: 1 }] })),
}));

vi.mock('../src/services/slack', () => ({
	slackService: {
		postMessage: vi.fn(),
		uploadFiles: vi.fn(async () => undefined),
	},
}));

import { createAutomationTools } from '../src/services/automation-tools';
import { slackService } from '../src/services/slack';

const CHANNEL_ID = 'C0123456789';
const ROOT_THREAD_ID = `slack:${CHANNEL_ID}:111.222`;

function slackIntegrations(): AutomationIntegrationConfig {
	return { slack: { enabled: true, channelId: CHANNEL_ID } };
}

function emptyContext(): ToolContext {
	return {
		projectFolder: '/tmp',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: null,
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTool(tool: any, input: Record<string, unknown>, context: ToolContext) {
	return tool.execute(input, { experimental_context: context, toolCallId: 'call-1', messages: [] });
}

describe('renderAutomationRunPrompt slack threading guidance', () => {
	it('includes the threading structure when slack is enabled', () => {
		const prompt = renderAutomationRunPrompt({
			prompt: 'Generate the weekly report',
			integrations: slackIntegrations(),
			userEmail: 'dennis@example.com',
		});
		expect(prompt).toContain('Slack posting structure');
		expect(prompt).toContain('thread_id');
		expect(prompt).toContain('starts the thread');
	});

	it('omits the threading structure when slack is disabled', () => {
		const prompt = renderAutomationRunPrompt({
			prompt: 'Generate the weekly report',
			integrations: { email: { enabled: true, recipients: ['a@b.com'] } },
			userEmail: 'dennis@example.com',
		});
		expect(prompt).not.toContain('Slack posting structure');
	});
});

describe('send_automation_slack_message threading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(slackService.uploadFiles).mockResolvedValue(undefined);
	});

	it('starts a thread on the first call and replies into it afterwards', async () => {
		vi.mocked(slackService.postMessage)
			.mockResolvedValueOnce({ channel: CHANNEL_ID, ts: '111.222', threadId: ROOT_THREAD_ID })
			.mockResolvedValueOnce({ channel: CHANNEL_ID, ts: '333.444', threadId: ROOT_THREAD_ID });

		const tools = createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: slackIntegrations(),
		});
		const tool = tools.send_automation_slack_message;
		const context = emptyContext();

		const headline = await runTool(tool, { text: 'Weekly Report: see thread' }, context);
		expect(headline).toMatchObject({ ok: true, threadId: ROOT_THREAD_ID });
		expect(vi.mocked(slackService.postMessage).mock.calls[0]).toEqual([
			'project-1',
			CHANNEL_ID,
			'Weekly Report: see thread',
			{ chatId: 'chat-1', threadId: undefined },
		]);

		await runTool(tool, { text: 'Full report body', thread_id: headline.threadId }, context);
		expect(vi.mocked(slackService.postMessage).mock.calls[1]).toEqual([
			'project-1',
			CHANNEL_ID,
			'Full report body',
			{ chatId: undefined, threadId: ROOT_THREAD_ID },
		]);
	});

	it('uploads each generated chart only once across multiple thread messages', async () => {
		vi.mocked(slackService.postMessage).mockResolvedValue({
			channel: CHANNEL_ID,
			ts: '111.222',
			threadId: ROOT_THREAD_ID,
		});

		const tools = createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: slackIntegrations(),
		});
		const tool = tools.send_automation_slack_message;
		const context = emptyContext();
		context.generatedArtifacts.charts = [
			{ type: 'bar', title: 'Revenue', query_id: 'q1' } as ToolContext['generatedArtifacts']['charts'][number],
		];

		const first = await runTool(tool, { text: 'Headline' }, context);
		expect(first.attachments).toEqual(['revenue.png']);

		const second = await runTool(tool, { text: 'Body', thread_id: ROOT_THREAD_ID }, context);
		expect(second.attachments).toEqual([]);

		const uploadedFiles = vi.mocked(slackService.uploadFiles).mock.calls.flatMap((call) => call[2]);
		expect(uploadedFiles).toHaveLength(1);
		expect(uploadedFiles[0].filename).toBe('revenue.png');
	});

	it('keeps the delivered message successful and retries failed attachments', async () => {
		vi.mocked(slackService.postMessage).mockResolvedValue({
			channel: CHANNEL_ID,
			ts: '111.222',
			threadId: ROOT_THREAD_ID,
		});
		vi.mocked(slackService.uploadFiles).mockRejectedValueOnce(new Error('not_in_channel'));

		const tools = createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: slackIntegrations(),
		});
		const tool = tools.send_automation_slack_message;
		const context = emptyContext();
		context.generatedArtifacts.charts = [
			{ type: 'bar', title: 'Revenue', query_id: 'q1' } as ToolContext['generatedArtifacts']['charts'][number],
		];

		const failedUpload = await runTool(tool, { text: 'Headline' }, context);
		expect(failedUpload).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: [],
			attachmentError: 'Files could not be uploaded: not_in_channel',
		});

		const retry = await runTool(tool, { text: 'Body', thread_id: ROOT_THREAD_ID }, context);
		expect(retry).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: ['revenue.png'],
		});
		expect(slackService.uploadFiles).toHaveBeenCalledTimes(2);
	});

	it('preserves successful uploads when a later attachment fails', async () => {
		vi.mocked(slackService.postMessage).mockResolvedValue({
			channel: CHANNEL_ID,
			ts: '111.222',
			threadId: ROOT_THREAD_ID,
		});
		vi.mocked(slackService.uploadFiles)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('upload_failed'));

		const tools = createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: slackIntegrations(),
		});
		const tool = tools.send_automation_slack_message;
		const context = emptyContext();
		context.generatedArtifacts.charts = [
			{ type: 'bar', title: 'Revenue', query_id: 'q1' } as ToolContext['generatedArtifacts']['charts'][number],
			{ type: 'bar', title: 'Expenses', query_id: 'q2' } as ToolContext['generatedArtifacts']['charts'][number],
		];

		const partialUpload = await runTool(tool, { text: 'Headline' }, context);
		expect(partialUpload).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: ['revenue.png'],
			attachmentError: 'Files could not be uploaded: upload_failed',
		});

		const retry = await runTool(tool, { text: 'Body', thread_id: ROOT_THREAD_ID }, context);
		expect(retry).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: ['expenses.png'],
		});
		expect(
			vi.mocked(slackService.uploadFiles).mock.calls.map((call) => call[2].map((file) => file.filename)),
		).toEqual([['revenue.png'], ['expenses.png'], ['expenses.png']]);
	});
});

describe('send_automation_slack_message with several channels', () => {
	const SECOND_CHANNEL = '#data-alerts';
	const SECOND_THREAD_ID = 'slack:C9876543210:555.666';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(slackService.uploadFiles).mockResolvedValue(undefined);
	});

	function createSlackTool(channelId: string) {
		return createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: { slack: { enabled: true, channelId } },
		}).send_automation_slack_message;
	}

	function mockPostMessageByChannel(threadIds: Record<string, string>) {
		vi.mocked(slackService.postMessage).mockImplementation(async (_projectId, channel) => {
			const threadId = threadIds[channel];
			if (!threadId) {
				throw new Error('channel_not_found');
			}
			return { channel, ts: threadId.split(':')[2], threadId };
		});
	}

	it('posts the headline to every channel and links the chat to the first thread only', async () => {
		mockPostMessageByChannel({ [CHANNEL_ID]: ROOT_THREAD_ID, [SECOND_CHANNEL]: SECOND_THREAD_ID });
		const tool = createSlackTool(`${CHANNEL_ID}, ${SECOND_CHANNEL}`);

		const headline = await runTool(tool, { text: 'Weekly Report' }, emptyContext());

		expect(headline).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			deliveries: [
				{ channel: CHANNEL_ID, ok: true, threadId: ROOT_THREAD_ID },
				{ channel: SECOND_CHANNEL, ok: true, threadId: SECOND_THREAD_ID },
			],
		});
		expect(vi.mocked(slackService.postMessage).mock.calls).toEqual([
			['project-1', CHANNEL_ID, 'Weekly Report', { chatId: 'chat-1', threadId: undefined }],
			['project-1', SECOND_CHANNEL, 'Weekly Report', { chatId: undefined, threadId: undefined }],
		]);
	});

	it('replies into the matching thread of each channel and uploads charts to each thread', async () => {
		mockPostMessageByChannel({ [CHANNEL_ID]: ROOT_THREAD_ID, [SECOND_CHANNEL]: SECOND_THREAD_ID });
		const tool = createSlackTool(`${CHANNEL_ID}, ${SECOND_CHANNEL}`);
		const context = emptyContext();
		context.generatedArtifacts.charts = [
			{ type: 'bar', title: 'Revenue', query_id: 'q1' } as ToolContext['generatedArtifacts']['charts'][number],
		];

		const headline = await runTool(tool, { text: 'Weekly Report' }, context);
		vi.mocked(slackService.postMessage).mockClear();
		await runTool(tool, { text: 'Full report', thread_id: headline.threadId }, context);

		expect(vi.mocked(slackService.postMessage).mock.calls).toEqual([
			['project-1', CHANNEL_ID, 'Full report', { chatId: undefined, threadId: ROOT_THREAD_ID }],
			['project-1', SECOND_CHANNEL, 'Full report', { chatId: undefined, threadId: SECOND_THREAD_ID }],
		]);
		expect(vi.mocked(slackService.uploadFiles).mock.calls.map((call) => call[1])).toEqual([
			ROOT_THREAD_ID,
			SECOND_THREAD_ID,
		]);
	});

	it('keeps delivering to valid channels and reports failed and malformed ones', async () => {
		mockPostMessageByChannel({ [SECOND_CHANNEL]: SECOND_THREAD_ID });
		const tool = createSlackTool(`#archived, ${SECOND_CHANNEL}, sales team`);

		const headline = await runTool(tool, { text: 'Weekly Report' }, emptyContext());

		expect(headline).toMatchObject({
			ok: true,
			threadId: SECOND_THREAD_ID,
			deliveries: [
				{ channel: '#archived', ok: false, error: 'channel_not_found' },
				{ channel: SECOND_CHANNEL, ok: true },
				{ channel: 'sales team', ok: false, error: 'Channel names cannot contain spaces.' },
			],
		});
		expect(vi.mocked(slackService.postMessage).mock.calls.map((call) => call[1])).toEqual([
			'#archived',
			SECOND_CHANNEL,
		]);
		expect(vi.mocked(slackService.postMessage).mock.calls[1][3]).toEqual({ chatId: 'chat-1', threadId: undefined });
	});

	it('fails when no channel receives the message', async () => {
		mockPostMessageByChannel({});
		const tool = createSlackTool('#archived, general');

		await expect(runTool(tool, { text: 'Weekly Report' }, emptyContext())).rejects.toThrow(
			'Slack message was not delivered to any channel. #archived: channel_not_found general: Add # before channel names, like #general.',
		);
	});

	it('rejects a thread_id that was not returned by a previous call', async () => {
		const tool = createSlackTool(`${CHANNEL_ID}, ${SECOND_CHANNEL}`);

		await expect(
			runTool(tool, { text: 'Full report', thread_id: 'slack:C0123456789:999.999' }, emptyContext()),
		).rejects.toThrow('Unknown thread_id');
		expect(slackService.postMessage).not.toHaveBeenCalled();
	});
});
