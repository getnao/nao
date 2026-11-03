import type { DateFormatSettings } from '@nao/shared/date';
import { getInvalidSlackChannels, getSlackChannelError, parseSlackChannels } from '@nao/shared/slack-channels';
import { extractQueryIds } from '@nao/shared/story-segments';
import type { displayChart, displayMap } from '@nao/shared/tools';
import { z } from 'zod/v4';

import { generateChartImage } from '../components/generate-chart';
import { generateMapImage } from '../components/generate-map';
import * as automationQueries from '../queries/automation.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import type { AutomationIntegrationConfig } from '../types/automation';
import type { EmailAttachment } from '../types/email';
import type { ToolContext } from '../types/tools';
import { logger } from '../utils/logger';
import { buildDownloadResponse, type QueryDataMap } from '../utils/story-download';
import { createTool } from '../utils/tools';
import { getActiveThemeForProject } from './custom-story';
import { emailService } from './email';
import {
	createGithubAutomationTools,
	getGithubToolDescriptions,
	getRequiredGithubToolNames,
	GITHUB_TOOL_NAMES,
	type GithubToolName,
} from './github-automation-tools';
import { getQueryResult } from './query-result.service';
import { type SlackFileUpload, slackService } from './slack';

export const AUTOMATION_INTEGRATION_TOOL_NAMES = [
	'send_automation_email',
	'send_automation_slack_message',
	...GITHUB_TOOL_NAMES,
] as const;

export type AutomationIntegrationToolName = (typeof AUTOMATION_INTEGRATION_TOOL_NAMES)[number];

export type AutomationIntegrationToolDescription = {
	name: AutomationIntegrationToolName;
	description: string;
	/** True when the agent MUST call this tool for the run to succeed. */
	required: boolean;
};

type AutomationToolInput = {
	projectId: string;
	chatId: string;
	githubToken: string | null;
	integrations: AutomationIntegrationConfig;
	automationId?: string;
	currentRunId?: string;
};

export function createAutomationTools(input: AutomationToolInput): Record<string, unknown> {
	return {
		...createHistoryTools(input.automationId, input.currentRunId),
		...createEmailTools(input.projectId, input.integrations),
		...createSlackTools(input.projectId, input.chatId, input.integrations),
		...createGithubAutomationTools({
			githubToken: input.githubToken,
			config: input.integrations.github ?? { enabled: false, repositories: [] },
		}),
	};
}

function createHistoryTools(automationId?: string, currentRunId?: string): Record<string, unknown> {
	if (!automationId) {
		return {};
	}

	return {
		get_automation_run_history: createTool({
			description: [
				'Look up what previous runs of THIS automation already did, so you avoid repeating work',
				'If the user asks for the history, review it before deciding what is new and worth reporting.',
			].join(' '),
			inputSchema: z.object({
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.default(10)
					.describe('How many of the most recent past runs to return.'),
			}),
			execute: async ({ limit }) => ({
				runs: await automationQueries.getAutomationRunHistory(automationId, {
					limit,
					excludeRunId: currentRunId,
				}),
			}),
		}),
	};
}

/** Tools the agent MUST call for the run to be considered a success. */
export function getAutomationIntegrationToolNames(
	integrations: AutomationIntegrationConfig,
): AutomationIntegrationToolName[] {
	return getAutomationIntegrationToolDescriptions(integrations)
		.filter((tool) => tool.required)
		.map((tool) => tool.name);
}

/** All integration tools advertised to the LLM (required + auxiliary). */
export function getAutomationIntegrationToolDescriptions(
	integrations: AutomationIntegrationConfig,
): AutomationIntegrationToolDescription[] {
	const tools: AutomationIntegrationToolDescription[] = [];
	if (integrations.email?.enabled) {
		tools.push({
			name: 'send_automation_email',
			description: getEmailToolDescription(),
			required: true,
		});
	}
	if (integrations.slack?.enabled) {
		tools.push({
			name: 'send_automation_slack_message',
			description: getSlackToolDescription(integrations.slack.channelId),
			required: true,
		});
	}
	for (const github of getGithubToolDescriptions(integrations.github)) {
		tools.push(github);
	}
	return tools;
}

/** Convenience alias re-exported so callers can detect GitHub tools without importing the inner module. */
export function isGithubAutomationTool(name: string): name is GithubToolName {
	return (GITHUB_TOOL_NAMES as readonly string[]).includes(name);
}

/** Convenience alias re-exported so callers can detect required GitHub tools. */
export function getRequiredGithubAutomationToolNames(integrations: AutomationIntegrationConfig): GithubToolName[] {
	return getRequiredGithubToolNames(integrations.github);
}

function createEmailTools(projectId: string, integrations: AutomationIntegrationConfig): Record<string, unknown> {
	const config = integrations.email;
	if (!config?.enabled) {
		return {};
	}

	return {
		send_automation_email: createTool({
			description: getEmailToolDescription(),
			inputSchema: z.object({
				recipients: z.array(z.string().min(1)).default([]),
				subject: z.string().min(1).optional(),
				html: z.string().min(1).optional(),
				text: z.string().min(1).optional(),
			}),
			execute: async ({ recipients, subject, html, text }, context: ToolContext) => {
				if (!emailService.isEnabled()) {
					throw new Error('SMTP email is not configured.');
				}
				const resolvedRecipients = [...new Set([...recipients, ...config.recipients])];
				const invalidRecipients = resolvedRecipients.filter(
					(recipient) => !z.string().email().safeParse(recipient).success,
				);
				if (invalidRecipients.length > 0) {
					throw new Error(`Invalid email recipient(s): ${invalidRecipients.join(', ')}`);
				}
				const attachments = await buildGeneratedArtifactAttachments(projectId, context);
				const content = appendInlineImages(html ?? `<pre>${escapeHtml(text ?? '')}</pre>`, attachments);
				const emailAttachments = attachments.map(toEmailAttachment);
				const resolvedSubject = config.subject ?? subject ?? 'nao automation report';
				await Promise.all(
					resolvedRecipients.map((recipient) =>
						emailService.sendEmail(
							recipient,
							{
								subject: resolvedSubject,
								html: content,
								attachments: emailAttachments,
							},
							{ throwOnError: true },
						),
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

	const channels = parseSlackChannels(config.channelId);
	const deliverableChannels = channels.filter((channel) => getSlackChannelError(channel) === null);
	const malformedDeliveries = getInvalidSlackChannels(channels).map(
		(channel): SlackChannelDelivery => ({ channel, ok: false, error: getSlackChannelError(channel) ?? undefined }),
	);
	const uploadedArtifactsByChannel = new Map<string, Set<string>>();
	const channelThreadsByHeadlineThreadId = new Map<string, SlackChannelThread[]>();

	async function postToChannels(
		targets: SlackChannelThread[],
		text: string,
		isReply: boolean,
	): Promise<SlackChannelDelivery[]> {
		const deliveries: SlackChannelDelivery[] = [];
		let isChatLinked = isReply;
		for (const target of targets) {
			const delivery = await postToChannel(target, text, !isChatLinked);
			isChatLinked ||= delivery.ok;
			deliveries.push(delivery);
		}
		return deliveries;
	}

	async function postToChannel(
		target: SlackChannelThread,
		text: string,
		linkChat: boolean,
	): Promise<SlackChannelDelivery> {
		try {
			const result = await slackService.postMessage(projectId, target.channel, text, {
				chatId: linkChat ? chatId : undefined,
				threadId: target.threadId,
			});
			return { channel: target.channel, ok: true, threadId: result.threadId };
		} catch (error) {
			return { channel: target.channel, ok: false, error: getErrorMessage(error) };
		}
	}

	async function attachArtifacts(
		deliveries: SlackChannelDelivery[],
		context: ToolContext,
	): Promise<SlackChannelDelivery[]> {
		let attachments: GeneratedArtifactAttachment[];
		try {
			attachments = await buildGeneratedArtifactAttachments(projectId, context);
		} catch (error) {
			const errorMessage = getErrorMessage(error);
			logger.warn(`Slack automation attachments could not be generated: ${errorMessage}`, {
				source: 'system',
				projectId,
			});
			const attachmentError = `Files could not be generated: ${errorMessage}`;
			return deliveries.map((delivery) =>
				delivery.threadId ? { ...delivery, attachments: [], attachmentError } : delivery,
			);
		}

		const deliveriesWithAttachments: SlackChannelDelivery[] = [];
		for (const delivery of deliveries) {
			const upload = delivery.threadId
				? await uploadArtifactsToThread(delivery.channel, delivery.threadId, attachments)
				: {};
			deliveriesWithAttachments.push({ ...delivery, ...upload });
		}
		return deliveriesWithAttachments;
	}

	async function uploadArtifactsToThread(
		channel: string,
		threadId: string,
		attachments: GeneratedArtifactAttachment[],
	): Promise<{ attachments: string[]; attachmentError?: string }> {
		const uploadedArtifacts = uploadedArtifactsByChannel.get(channel) ?? new Set<string>();
		uploadedArtifactsByChannel.set(channel, uploadedArtifacts);
		const pendingAttachments = attachments.filter((attachment) => !uploadedArtifacts.has(attachment.filename));
		const uploadedAttachments: string[] = [];
		for (const [index, attachment] of pendingAttachments.entries()) {
			try {
				await slackService.uploadFiles(projectId, threadId, [toSlackFileUpload(attachment)]);
				uploadedArtifacts.add(attachment.filename);
				uploadedAttachments.push(attachment.filename);
			} catch (error) {
				const errorMessage = getErrorMessage(error);
				logger.warn(`Slack automation attachment upload failed: ${errorMessage}`, {
					source: 'system',
					projectId,
					context: {
						threadId,
						attachments: pendingAttachments.slice(index).map((pending) => pending.filename),
					},
				});
				return {
					attachments: uploadedAttachments,
					attachmentError: `Files could not be uploaded: ${errorMessage}`,
				};
			}
		}
		return { attachments: uploadedAttachments };
	}

	function resolveTargets(threadId: string | undefined): SlackChannelThread[] {
		if (!threadId) {
			return deliverableChannels.map((channel) => ({ channel }));
		}
		const targets = channelThreadsByHeadlineThreadId.get(threadId);
		if (!targets) {
			throw new Error(
				`Unknown thread_id "${threadId}". Reuse the threadId returned by a previous call, or omit thread_id to post a new headline.`,
			);
		}
		return targets;
	}

	return {
		send_automation_slack_message: createTool({
			description: getSlackToolDescription(config.channelId),
			inputSchema: z.object({
				text: z.string().min(1),
				thread_id: z
					.string()
					.optional()
					.describe(
						'Reuse the `threadId` returned by a previous call to post this message inside that thread instead of the channel.',
					),
			}),
			execute: async ({ text, thread_id }, context: ToolContext) => {
				const posts = await postToChannels(resolveTargets(thread_id), text, Boolean(thread_id));
				const delivered = posts.filter((delivery) => delivery.ok && delivery.threadId);
				const threadId = thread_id ?? delivered[0]?.threadId;
				if (!threadId || delivered.length === 0) {
					const deliveries = thread_id ? posts : [...posts, ...malformedDeliveries];
					return {
						ok: false,
						error: `Slack message was not delivered to any channel. ${formatDeliveryErrors(deliveries)}`,
						deliveries,
					};
				}

				if (!thread_id) {
					channelThreadsByHeadlineThreadId.set(
						threadId,
						delivered.map((delivery) => ({ channel: delivery.channel, threadId: delivery.threadId })),
					);
				}
				const postsWithAttachments = await attachArtifacts(posts, context);
				const attachmentError = postsWithAttachments.find(
					(delivery) => delivery.attachmentError,
				)?.attachmentError;
				return {
					ok: true,
					threadId,
					attachments: [...new Set(postsWithAttachments.flatMap((delivery) => delivery.attachments ?? []))],
					...(attachmentError && { attachmentError }),
					deliveries: thread_id ? postsWithAttachments : [...postsWithAttachments, ...malformedDeliveries],
				};
			},
		}),
	};
}

type SlackChannelThread = {
	channel: string;
	threadId?: string;
};

export type SlackChannelDelivery = {
	channel: string;
	ok: boolean;
	error?: string;
	threadId?: string;
	attachments?: string[];
	attachmentError?: string;
};

function formatDeliveryErrors(deliveries: SlackChannelDelivery[]): string {
	if (deliveries.length === 0) {
		return 'No Slack channel is configured for this automation.';
	}
	return deliveries.map((delivery) => `${delivery.channel}: ${delivery.error}`).join(' ');
}

function getEmailToolDescription(): string {
	return `Send an email to a list of recipients. Provide html (preferred) or text, and optionally a subject. If you generated charts with display_chart or maps with display_map, they will be embedded as images. If you generated a story, it will be attached as a PDF.`;
}

function getSlackToolDescription(channelIds: string): string {
	const channels = parseSlackChannels(channelIds);
	const destination =
		channels.length > 1
			? `every one of the Slack channels ${channels.join(', ')} (one call delivers to all of them)`
			: `the Slack channel ${channels[0] ?? channelIds}`;
	return [
		`Post a message in ${destination}. Provide the markdown-friendly text to post. Use @slack-handle to mention a Slack user.`,
		'To avoid cluttering the channel, post a single short headline message first (no thread_id), then reply with the full report inside its thread by passing the returned threadId as thread_id.',
		'The call returns a threadId; reuse it as thread_id for every follow-up message so they stay in the same thread.',
		'Generated charts, maps and stories are uploaded to the thread automatically.',
	].join(' ');
}

type GeneratedArtifactAttachment = Omit<EmailAttachment, 'content'> & {
	kind: 'chart' | 'map' | 'story';
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

async function buildGeneratedArtifactAttachments(
	projectId: string,
	context: ToolContext,
): Promise<GeneratedArtifactAttachment[]> {
	const displaySettings = await projectQueries.getDisplaySettings(projectId);
	const dateFormat = displaySettings.dateFormat ?? null;
	const chartAttachments = await buildChartImageAttachments(context, dateFormat);
	const mapAttachments = await buildMapImageAttachments(projectId, context);
	const storyAttachments = await buildStoryPdfAttachments(projectId, context, dateFormat);
	return [...chartAttachments, ...mapAttachments, ...storyAttachments];
}

async function buildMapImageAttachments(
	projectId: string,
	context: ToolContext,
): Promise<GeneratedArtifactAttachment[]> {
	const maps = uniqueMaps(context.generatedArtifacts.maps);
	if (maps.length === 0) {
		return [];
	}
	const customBoundaries = await projectQueries.getCustomBoundaries(projectId);
	const attachments: GeneratedArtifactAttachment[] = [];

	for (const [index, map] of maps.entries()) {
		const queryResult = await getQueryResult(context, map.query_id);
		if (!queryResult) {
			continue;
		}
		const png = await generateMapImage({ config: map, rows: queryResult.data, customBoundaries });
		if (!png) {
			continue;
		}
		const title = map.title ?? `Map ${index + 1}`;
		attachments.push({
			kind: 'map',
			title,
			filename: sanitizeFilename(`map-${index + 1}-${title}`, `map-${index + 1}`, 'png'),
			content: png,
			contentType: 'image/png',
			cid: `automation-map-${index}-${crypto.randomUUID()}@nao`,
		});
	}

	return attachments;
}

async function buildChartImageAttachments(
	context: ToolContext,
	dateFormat: DateFormatSettings | null,
): Promise<GeneratedArtifactAttachment[]> {
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
			content: generateChartImage({ config: chart, data: queryResult.data, dateFormat }),
			contentType: 'image/png',
			cid: `automation-chart-${index}-${crypto.randomUUID()}@nao`,
		});
	}

	return attachments;
}

async function buildStoryPdfAttachments(
	projectId: string,
	context: ToolContext,
	dateFormat: DateFormatSettings | null,
): Promise<GeneratedArtifactAttachment[]> {
	const stories = uniqueStories(context.generatedArtifacts.stories);
	if (stories.length === 0) {
		return [];
	}
	const theme = await getActiveThemeForProject(projectId);

	return Promise.all(
		stories.map(async (story) => {
			const latest = await storyQueries.getLatestVersionByChatAndSlug(context.chatId, story.id);
			if (!latest) {
				throw new Error(`Story "${story.id}" was generated but could not be found for PDF export.`);
			}

			const queryData = await getStoryQueryData(context, latest.code);
			const pdf = await buildDownloadResponse('pdf', latest.title, latest.code, queryData, dateFormat, theme);
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
	const queryIds = extractQueryIds(code);
	if (queryIds.size === 0) {
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

function appendInlineImages(html: string, attachments: GeneratedArtifactAttachment[]): string {
	const images = attachments.filter(
		(attachment) => (attachment.kind === 'chart' || attachment.kind === 'map') && attachment.cid,
	);
	if (images.length === 0) {
		return html;
	}

	const heading = images.some((image) => image.kind === 'map') ? 'Generated visuals' : 'Generated charts';
	const section = [
		'<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;" />',
		`<h2 style="font-size:18px;line-height:24px;margin:0 0 16px;">${heading}</h2>`,
		...images.map(
			(image) =>
				`<figure style="margin:0 0 24px;"><img src="cid:${image.cid}" alt="${escapeHtml(
					image.title ?? 'Visual',
				)}" style="max-width:100%;height:auto;" /><figcaption style="color:#6b7280;font-size:12px;margin-top:8px;">${escapeHtml(
					image.title ?? 'Visual',
				)}</figcaption></figure>`,
		),
	].join('');

	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${section}</body>`);
	}
	return `${html}${section}`;
}

function uniqueCharts(
	charts: (displayChart.ChartInput | displayChart.KpiCardInput)[],
): (displayChart.ChartInput | displayChart.KpiCardInput)[] {
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

function uniqueMaps(maps: displayMap.Input[]): displayMap.Input[] {
	const seen = new Set<string>();
	return maps.filter((map) => {
		const key = JSON.stringify(map);
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

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
