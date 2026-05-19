import type { displayChart } from '@nao/shared/tools';
import { execFile } from 'child_process';
import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import * as storyQueries from '../queries/story.queries';
import type { AutomationIntegrationConfig } from '../types/automation';
import type { EmailAttachment } from '../types/email';
import type { ToolContext } from '../types/tools';
import { buildDownloadResponse, type QueryDataMap } from '../utils/story-download';
import { createTool } from '../utils/tools';
import { emailService } from './email';
import { getQueryResult } from './query-result.service';
import { type SlackFileUpload, slackService } from './slack';

export const AUTOMATION_INTEGRATION_TOOL_NAMES = [
	'send_automation_email',
	'send_automation_slack_message',
	'github_cli',
] as const;

export type AutomationIntegrationToolName = (typeof AUTOMATION_INTEGRATION_TOOL_NAMES)[number];

export type AutomationIntegrationToolDescription = {
	name: AutomationIntegrationToolName;
	description: string;
};

type AutomationToolInput = {
	projectId: string;
	chatId: string;
	githubToken: string | null;
	integrations: AutomationIntegrationConfig;
};

export function createAutomationTools(input: AutomationToolInput): Record<string, unknown> {
	return {
		...createEmailTools(input.integrations),
		...createSlackTools(input.projectId, input.chatId, input.integrations),
		...createGithubTools(input.githubToken, input.integrations),
	};
}

export function getAutomationIntegrationToolNames(
	integrations: AutomationIntegrationConfig,
): AutomationIntegrationToolName[] {
	return getAutomationIntegrationToolDescriptions(integrations).map((tool) => tool.name);
}

export function getAutomationIntegrationToolDescriptions(
	integrations: AutomationIntegrationConfig,
): AutomationIntegrationToolDescription[] {
	const tools: AutomationIntegrationToolDescription[] = [];
	if (integrations.email?.enabled) {
		tools.push({
			name: 'send_automation_email',
			description: getEmailToolDescription(),
		});
	}
	if (integrations.slack?.enabled) {
		tools.push({
			name: 'send_automation_slack_message',
			description: getSlackToolDescription(integrations.slack.channelId),
		});
	}
	if (integrations.github?.enabled) {
		tools.push({
			name: 'github_cli',
			description: getGithubToolDescription(integrations.github.repositories),
		});
	}
	return tools;
}

function createEmailTools(integrations: AutomationIntegrationConfig): Record<string, unknown> {
	const config = integrations.email;
	if (!config?.enabled) {
		return {};
	}

	return {
		send_automation_email: createTool({
			description: getEmailToolDescription(),
			inputSchema: z.object({
				recipients: z.array(z.string().email()).default([]),
				subject: z.string().min(1).optional(),
				html: z.string().min(1).optional(),
				text: z.string().min(1).optional(),
			}),
			execute: async ({ recipients, subject, html, text }, context: ToolContext) => {
				if (!emailService.isEnabled()) {
					throw new Error('SMTP email is not configured.');
				}
				const attachments = await buildGeneratedArtifactAttachments(context);
				const content = appendInlineChartImages(html ?? `<pre>${escapeHtml(text ?? '')}</pre>`, attachments);
				const emailAttachments = attachments.map(toEmailAttachment);
				const resolvedSubject = config.subject ?? subject ?? 'nao automation report';
				const resolvedRecipients = [...new Set([...recipients, ...config.recipients])];
				await Promise.all(
					resolvedRecipients.map((recipient) =>
						emailService.sendEmail(recipient, {
							subject: resolvedSubject,
							html: content,
							attachments: emailAttachments,
						}),
					),
				);
				return { ok: true, recipients: resolvedRecipients, attachments: attachments.map((a) => a.filename) };
			},
		}),
	};
}

function createSlackTools(
	projectId: string,
	chatId: string,
	integrations: AutomationIntegrationConfig,
): Record<string, unknown> {
	const config = integrations.slack;
	if (!config?.enabled) {
		return {};
	}

	return {
		send_automation_slack_message: createTool({
			description: getSlackToolDescription(config.channelId),
			inputSchema: z.object({
				text: z.string().min(1),
			}),
			execute: async ({ text }, context: ToolContext) => {
				const result = await slackService.postMessage(projectId, config.channelId, text, { chatId });
				const attachments = await buildGeneratedArtifactAttachments(context);
				await slackService.uploadFiles(projectId, result.threadId, attachments.map(toSlackFileUpload));
				return { ok: true, ...result, attachments: attachments.map((attachment) => attachment.filename) };
			},
		}),
	};
}

function createGithubTools(
	githubToken: string | null,
	integrations: AutomationIntegrationConfig,
): Record<string, unknown> {
	const config = integrations.github;
	if (!config?.enabled) {
		return {};
	}

	return {
		github_cli: createTool({
			description: getGithubToolDescription(config.repositories),
			inputSchema: z.object({
				command: z
					.string()
					.describe(
						'The gh CLI command to run, without the leading "gh". ' +
							'Examples: "issue create --repo owner/repo --title Bug --body Details", ' +
							'"pr list --repo owner/repo --state open --json number,title", ' +
							'"issue view 42 --repo owner/repo". ' +
							'Prefer --json for machine-readable output when reading data.',
					),
			}),
			execute: async ({ command }) => {
				if (!githubToken) {
					throw new Error('GitHub is not connected for the automation owner.');
				}
				const args = parseShellArgs(command);
				assertCommandSafe(args);
				assertRepositoryAllowed(extractRepoFromArgs(args), config.repositories);
				return executeGhCommand(args, githubToken);
			},
		}),
	};
}

function getEmailToolDescription(): string {
	return `Send an email to a list of recipients. Provide html (preferred) or text, and optionally a subject. If you generated charts with display_chart, they will be embedded as images. If you generated a story, it will be attached as a PDF.`;
}

function getSlackToolDescription(channelId: string): string {
	return `Post a message in the Slack channel ${channelId}. Provide the markdown-friendly text to post. Use @slack-handle to mention a Slack user.`;
}

function getGithubToolDescription(repositories: string[]): string {
	const repos =
		repositories.length > 0 ? repositories.join(', ') : '(any repository the connected GitHub account can access)';
	return (
		`Run any GitHub CLI (gh) command against ${repos}. ` +
		'You can read issues, PRs, repos, search, list, view, create issues, comment, create PRs, etc. ' +
		'Destructive operations (delete, close, merge, archive) are blocked for safety. ' +
		'Always pass --repo owner/repo explicitly. Prefer --json for structured output.'
	);
}

const BLOCKED_COMMANDS: Array<{ resource: string; subcommand: string }> = [
	{ resource: 'issue', subcommand: 'close' },
	{ resource: 'issue', subcommand: 'delete' },
	{ resource: 'issue', subcommand: 'lock' },
	{ resource: 'issue', subcommand: 'unpin' },
	{ resource: 'issue', subcommand: 'transfer' },
	{ resource: 'pr', subcommand: 'close' },
	{ resource: 'pr', subcommand: 'merge' },
	{ resource: 'repo', subcommand: 'delete' },
	{ resource: 'repo', subcommand: 'archive' },
	{ resource: 'repo', subcommand: 'rename' },
	{ resource: 'repo', subcommand: 'unarchive' },
	{ resource: 'release', subcommand: 'delete' },
	{ resource: 'label', subcommand: 'delete' },
	{ resource: 'variable', subcommand: 'delete' },
	{ resource: 'secret', subcommand: 'delete' },
	{ resource: 'secret', subcommand: 'set' },
];

function assertCommandSafe(args: string[]): void {
	if (args.length === 0) {
		throw new Error('Empty gh command.');
	}

	const resource = args[0].toLowerCase();
	const subcommand = args[1]?.toLowerCase() ?? '';

	if (resource === 'auth') {
		throw new Error('gh auth commands are not allowed.');
	}

	if (resource === 'api') {
		const methodIdx = args.findIndex((a) => a === '-X' || a === '--method');
		const method = methodIdx >= 0 ? args[methodIdx + 1]?.toUpperCase() : 'GET';
		if (method === 'DELETE') {
			throw new Error('DELETE requests via gh api are not allowed.');
		}
		return;
	}

	for (const blocked of BLOCKED_COMMANDS) {
		if (resource === blocked.resource && subcommand === blocked.subcommand) {
			throw new Error(`"gh ${resource} ${subcommand}" is blocked for safety.`);
		}
	}
}

function extractRepoFromArgs(args: string[]): string | null {
	for (let i = 0; i < args.length; i++) {
		if ((args[i] === '--repo' || args[i] === '-R') && i + 1 < args.length) {
			return args[i + 1];
		}
	}
	return null;
}

function assertRepositoryAllowed(repository: string | null, allowedRepositories: string[]): void {
	if (allowedRepositories.length === 0) {
		return;
	}
	if (!repository) {
		throw new Error('--repo owner/repo is required when repositories are restricted.');
	}
	if (!allowedRepositories.includes(repository)) {
		throw new Error(`Repository "${repository}" is not enabled for this automation.`);
	}
}

function parseShellArgs(command: string): string[] {
	const args: string[] = [];
	let current = '';
	let quote: string | null = null;

	for (const ch of command) {
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === ' ' || ch === '\t') {
			if (current) {
				args.push(current);
				current = '';
			}
		} else {
			current += ch;
		}
	}
	if (current) {
		args.push(current);
	}
	return args;
}

const GH_TIMEOUT_MS = 30_000;

function executeGhCommand(args: string[], token: string): Promise<{ ok: true; output: string }> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			'gh',
			args,
			{
				timeout: GH_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
				env: { ...process.env, GH_TOKEN: token },
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`gh command failed: ${stderr || error.message}`));
					return;
				}
				resolve({ ok: true, output: stdout.trim() });
			},
		);
		child.stdin?.end();
	});
}

type GeneratedArtifactAttachment = Omit<EmailAttachment, 'content'> & {
	kind: 'chart' | 'story';
	content: Buffer;
	title?: string;
};

function toEmailAttachment(attachment: GeneratedArtifactAttachment): EmailAttachment {
	return {
		filename: attachment.filename,
		content: attachment.content,
		...(attachment.contentType && { contentType: attachment.contentType }),
		...(attachment.cid && { cid: attachment.cid }),
	};
}

function toSlackFileUpload(attachment: GeneratedArtifactAttachment): SlackFileUpload {
	return {
		filename: attachment.filename,
		content: attachment.content,
		title: attachment.title,
	};
}

async function buildGeneratedArtifactAttachments(context: ToolContext): Promise<GeneratedArtifactAttachment[]> {
	const chartAttachments = await buildChartImageAttachments(context);
	const storyAttachments = await buildStoryPdfAttachments(context);
	return [...chartAttachments, ...storyAttachments];
}

async function buildChartImageAttachments(context: ToolContext): Promise<GeneratedArtifactAttachment[]> {
	const charts = uniqueCharts(context.generatedArtifacts.charts);
	const attachments: GeneratedArtifactAttachment[] = [];

	for (const [index, chart] of charts.entries()) {
		const queryResult = await getQueryResult(context, chart.query_id);
		if (!queryResult) {
			continue;
		}

		const title = chart.title ?? `Chart ${index + 1}`;
		attachments.push({
			kind: 'chart',
			title,
			filename: sanitizeFilename(title, `chart-${index + 1}`, 'png'),
			content: generateChartImage({ config: chart, data: queryResult.data }),
			contentType: 'image/png',
			cid: `automation-chart-${index}-${crypto.randomUUID()}@nao`,
		});
	}

	return attachments;
}

async function buildStoryPdfAttachments(context: ToolContext): Promise<GeneratedArtifactAttachment[]> {
	const stories = uniqueStories(context.generatedArtifacts.stories);

	return Promise.all(
		stories.map(async (story) => {
			const latest = await storyQueries.getLatestVersionByChatAndSlug(context.chatId, story.id);
			if (!latest) {
				throw new Error(`Story "${story.id}" was generated but could not be found for PDF export.`);
			}

			const queryData = await getStoryQueryData(context, latest.code);
			const pdf = await buildDownloadResponse('pdf', latest.title, latest.code, queryData);
			return {
				kind: 'story',
				title: latest.title,
				filename: pdf.filename,
				content: Buffer.from(pdf.data, 'base64'),
				contentType: pdf.mimeType,
			} satisfies GeneratedArtifactAttachment;
		}),
	);
}

async function getStoryQueryData(context: ToolContext, code: string): Promise<QueryDataMap | null> {
	const queryIds = extractStoryQueryIds(code);
	if (queryIds.length === 0) {
		return null;
	}

	const queryData: QueryDataMap = {};
	for (const queryId of queryIds) {
		const result = await getQueryResult(context, queryId);
		if (result) {
			queryData[queryId] = result;
		}
	}

	return Object.keys(queryData).length > 0 ? queryData : null;
}

function extractStoryQueryIds(code: string): string[] {
	const queryIds = new Set<string>();
	const chartRegex = /<(?:chart|table)\s+[^>]*query_id="([^"]*)"[^>]*\/?>/g;
	let match: RegExpExecArray | null;
	while ((match = chartRegex.exec(code)) !== null) {
		queryIds.add(match[1]);
	}
	return [...queryIds];
}

function appendInlineChartImages(html: string, attachments: GeneratedArtifactAttachment[]): string {
	const charts = attachments.filter((attachment) => attachment.kind === 'chart' && attachment.cid);
	if (charts.length === 0) {
		return html;
	}

	const chartSection = [
		'<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;" />',
		'<h2 style="font-size:18px;line-height:24px;margin:0 0 16px;">Generated charts</h2>',
		...charts.map(
			(chart) =>
				`<figure style="margin:0 0 24px;"><img src="cid:${chart.cid}" alt="${escapeHtml(
					chart.title ?? 'Chart',
				)}" style="max-width:100%;height:auto;" /><figcaption style="color:#6b7280;font-size:12px;margin-top:8px;">${escapeHtml(
					chart.title ?? 'Chart',
				)}</figcaption></figure>`,
		),
	].join('');

	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${chartSection}</body>`);
	}
	return `${html}${chartSection}`;
}

function uniqueCharts(charts: displayChart.Input[]): displayChart.Input[] {
	const seen = new Set<string>();
	return charts.filter((chart) => {
		const key = JSON.stringify(chart);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function uniqueStories(
	stories: ToolContext['generatedArtifacts']['stories'],
): ToolContext['generatedArtifacts']['stories'] {
	const byId = new Map<string, { id: string; title: string }>();
	for (const story of stories) {
		byId.set(story.id, story);
	}
	return [...byId.values()];
}

function sanitizeFilename(value: string, fallback: string, extension: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
	return `${slug || fallback}.${extension}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}
