import type { Tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAutomationRunPrompt } from '../../src/components/ai/automation-run-prompt';
import type { AutomationIntegrationConfig } from '../../src/types/automation';
import type { ToolContext } from '../../src/types/tools';

// The db module imports bun:sqlite, which is unavailable under the node-based
// vitest runner; stub it so the automation-tools import chain can load.
vi.mock('../../src/db/db', () => ({ db: {} }));

vi.mock('../../src/queries/project.queries', () => ({
	getDisplaySettings: vi.fn(async () => ({ dateFormat: null })),
}));

vi.mock('../../src/components/generate-chart', () => ({
	generateChartImage: vi.fn(() => Buffer.from('png')),
}));

vi.mock('../../src/services/query-result.service', () => ({
	getQueryResult: vi.fn(async () => ({ columns: ['a'], data: [{ a: 1 }] })),
}));

vi.mock('../../src/services/slack', () => ({
	slackService: {
		postMessage: vi.fn(),
		uploadFiles: vi.fn(async () => undefined),
	},
}));

import { createAutomationTools } from '../../src/services/automation-tools';
import { slackService } from '../../src/services/slack';
import { createToolContext, executeTool } from '../helpers/tool-context';

type ChartArtifact = ToolContext['generatedArtifacts']['charts'][number];
type SlackMessageInput = { text: string; thread_id?: string };
type SlackMessageOutput = { ok: boolean; threadId?: string; attachments?: string[]; attachmentError?: string };

const CHANNEL_ID = 'C123';
const ROOT_THREAD_ID = `slack:${CHANNEL_ID}:111.222`;

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
		const sendSlackMessage = createSendSlackMessage(createToolContext());

		const headline = await sendSlackMessage({ text: 'Weekly Report: see thread' });
		expect(headline).toMatchObject({ ok: true, threadId: ROOT_THREAD_ID });
		expect(vi.mocked(slackService.postMessage).mock.calls[0]).toEqual([
			'project-1',
			CHANNEL_ID,
			'Weekly Report: see thread',
			{ chatId: 'chat-1', threadId: undefined },
		]);

		await sendSlackMessage({ text: 'Full report body', thread_id: headline.threadId });
		expect(vi.mocked(slackService.postMessage).mock.calls[1]).toEqual([
			'project-1',
			CHANNEL_ID,
			'Full report body',
			{ chatId: 'chat-1', threadId: ROOT_THREAD_ID },
		]);
	});

	it('uploads each generated chart only once across multiple thread messages', async () => {
		mockPostMessageInRootThread();
		const sendSlackMessage = createSendSlackMessage(contextWithCharts([chart('Revenue', 'q1')]));

		const first = await sendSlackMessage({ text: 'Headline' });
		expect(first.attachments).toEqual(['revenue.png']);

		const second = await sendSlackMessage({ text: 'Body', thread_id: ROOT_THREAD_ID });
		expect(second.attachments).toEqual([]);

		const uploadedFiles = vi.mocked(slackService.uploadFiles).mock.calls.flatMap((call) => call[2]);
		expect(uploadedFiles).toHaveLength(1);
		expect(uploadedFiles[0].filename).toBe('revenue.png');
	});

	it('keeps the delivered message successful and retries failed attachments', async () => {
		mockPostMessageInRootThread();
		vi.mocked(slackService.uploadFiles).mockRejectedValueOnce(new Error('not_in_channel'));
		const sendSlackMessage = createSendSlackMessage(contextWithCharts([chart('Revenue', 'q1')]));

		const failedUpload = await sendSlackMessage({ text: 'Headline' });
		expect(failedUpload).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: [],
			attachmentError: 'Files could not be uploaded: not_in_channel',
		});

		const retry = await sendSlackMessage({ text: 'Body', thread_id: ROOT_THREAD_ID });
		expect(retry).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: ['revenue.png'],
		});
		expect(slackService.uploadFiles).toHaveBeenCalledTimes(2);
	});

	it('preserves successful uploads when a later attachment fails', async () => {
		mockPostMessageInRootThread();
		vi.mocked(slackService.uploadFiles)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('upload_failed'));
		const sendSlackMessage = createSendSlackMessage(
			contextWithCharts([chart('Revenue', 'q1'), chart('Expenses', 'q2')]),
		);

		const partialUpload = await sendSlackMessage({ text: 'Headline' });
		expect(partialUpload).toMatchObject({
			ok: true,
			threadId: ROOT_THREAD_ID,
			attachments: ['revenue.png'],
			attachmentError: 'Files could not be uploaded: upload_failed',
		});

		const retry = await sendSlackMessage({ text: 'Body', thread_id: ROOT_THREAD_ID });
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

function slackIntegrations(): AutomationIntegrationConfig {
	return { slack: { enabled: true, channelId: CHANNEL_ID } };
}

function createSendSlackMessage(context: ToolContext) {
	const tool = createAutomationTools({
		projectId: 'project-1',
		chatId: 'chat-1',
		githubToken: null,
		integrations: slackIntegrations(),
	}).send_automation_slack_message as Tool<SlackMessageInput, SlackMessageOutput>;
	return (input: SlackMessageInput) => executeTool(tool, input, context);
}

function mockPostMessageInRootThread(): void {
	vi.mocked(slackService.postMessage).mockResolvedValue({
		channel: CHANNEL_ID,
		ts: '111.222',
		threadId: ROOT_THREAD_ID,
	});
}

function contextWithCharts(charts: ChartArtifact[]): ToolContext {
	return createToolContext({ generatedArtifacts: { charts, maps: [], stories: [] } });
}

function chart(title: string, queryId: string): ChartArtifact {
	return { type: 'bar', title, query_id: queryId } as ChartArtifact;
}
