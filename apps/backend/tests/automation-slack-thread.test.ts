import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAutomationRunPrompt } from '../src/components/ai/automation-run-prompt';
import type { AutomationIntegrationConfig } from '../src/types/automation';
import type { ToolContext } from '../src/types/tools';

// The db module imports bun:sqlite, which is unavailable under the node-based
// vitest runner; stub it so the automation-tools import chain can load.
vi.mock('../src/db/db', () => ({ db: {} }));

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

const CHANNEL_ID = 'C123';
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
			{ chatId: 'chat-1', threadId: ROOT_THREAD_ID },
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
});
