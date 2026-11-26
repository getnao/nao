import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { nextCronTick } from '../../services/scheduler.service';
import { type StoryLiveSettings, updateStoryLiveSettings } from '../../services/story-refresh.service';
import type { McpContext } from '../logging';
import { resolveStory } from './helpers';
import { jsonToolResult, type RegisterMcpToolOptions } from './register-mcp-tool';

const SET_STORY_LIVE_DESCRIPTION =
	'Turn live on or off for one of the user’s stories, or change how often nao refreshes its data. ' +
	'Live settings belong to the story, so this creates no new version.\n\n' +
	'USE WHEN: the user asks for a story that stays up to date, e.g. "refresh it every Monday at 9am", ' +
	'or to stop updating one. Create or edit the story content with the story tool first.';

export const STORY_LIVE_INPUT = z
	.object({
		enabled: z
			.boolean()
			.describe('Turn live on or off. Turning it off also clears `refresh_schedule` and `regenerate_text`.'),
		refresh_schedule: z
			.string()
			.nullable()
			.optional()
			.refine(isValidRefreshSchedule, { message: 'Invalid cron expression for `refresh_schedule`.' })
			.describe(
				'When nao refreshes the data: a 5-field cron expression (minute hour day-of-month month day-of-week), ' +
					`e.g. "0 9 * * 1" for every Monday at 9am; "${NO_CACHE_SCHEDULE}" to rerun the queries each time the ` +
					'story is opened; null to refresh only by hand.',
			),
		refresh_schedule_description: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe('The schedule in plain words, as the user said it (e.g. "every Monday at 9am"). Shown in nao.'),
		regenerate_text: z
			.boolean()
			.optional()
			.describe(
				'Rewrite the story text with the refreshed numbers, keeping its structure, charts, tables and titles.',
			),
	})
	.optional()
	.describe(
		'Live settings: a live story reruns its queries to keep its data up to date. Set it only when the user asks ' +
			'for a live or auto-updating story. On `update_story`, omitted fields keep their current value.',
	);

export type StoryLiveInput = NonNullable<z.infer<typeof STORY_LIVE_INPUT>>;

export type StoryLiveOutput = {
	enabled: boolean;
	refreshSchedule: string | null;
	refreshScheduleDescription: string | null;
	regenerateText: boolean;
};

export const NOT_LIVE_SETTINGS: StoryLiveSettings = {
	isLive: false,
	isLiveTextDynamic: false,
	cacheSchedule: null,
	cacheScheduleDescription: null,
};

type LiveStory = StoryLiveSettings & { id: string; title: string };

type LiveSettingsOutcome = { live?: StoryLiveOutput } | { error: string };

/** The live settings tool of the agent's internal server, where it costs nothing until a run needs it. */
export function setStoryLiveMcpTool(owner: Pick<McpContext, 'projectId' | 'userId'>): RegisterMcpToolOptions {
	return {
		name: 'set_story_live',
		title: 'Set Story Live',
		description: SET_STORY_LIVE_DESCRIPTION,
		inputSchema: {
			story_id: z.string().describe('Story UUID, the `story_id` the story tool returns. Not the slug.'),
			live: STORY_LIVE_INPUT.unwrap().describe('Omitted fields keep their current value.'),
		},
		errorMessage: (error) => (error instanceof Error ? error.message : 'set_story_live failed. Please try again.'),
		handler: async ({ story_id, live }) => {
			const story = await resolveStory(story_id, owner);
			const saved = await saveMcpLiveSettings(story, live);
			if ('error' in saved) {
				return { content: [{ type: 'text' as const, text: saved.error }], isError: true };
			}
			return jsonToolResult({ story_id: story.id, title: story.title, ...saved });
		},
	};
}

export function toStoryLiveOutput(settings: StoryLiveSettings): StoryLiveOutput {
	return {
		enabled: settings.isLive,
		refreshSchedule: settings.cacheSchedule,
		refreshScheduleDescription: settings.cacheScheduleDescription,
		regenerateText: settings.isLiveTextDynamic,
	};
}

/** Call it once the story content is saved: nao only lets a story go live when it can rerun the queries it reads. */
export async function saveMcpLiveSettings(
	story: LiveStory,
	input: StoryLiveInput | undefined,
): Promise<LiveSettingsOutcome> {
	if (!input) {
		return {};
	}
	const settings = mergeLiveSettings(story, input);
	try {
		await updateStoryLiveSettings(story.id, settings);
	} catch (error) {
		if (error instanceof TRPCError && error.code === 'BAD_REQUEST') {
			return {
				error: `The story "${story.title}" (story_id "${story.id}") is saved, but its live settings were not changed: ${error.message}`,
			};
		}
		throw error;
	}
	return { live: toStoryLiveOutput(settings) };
}

function mergeLiveSettings(current: StoryLiveSettings, input: StoryLiveInput): StoryLiveSettings {
	if (!input.enabled) {
		return NOT_LIVE_SETTINGS;
	}
	const keepsSchedule = input.refresh_schedule === undefined;
	const cacheSchedule = keepsSchedule ? current.cacheSchedule : (input.refresh_schedule ?? null);
	const description = input.refresh_schedule_description ?? (keepsSchedule ? current.cacheScheduleDescription : null);
	return {
		isLive: true,
		isLiveTextDynamic: input.regenerate_text ?? current.isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription: isRecurringSchedule(cacheSchedule) ? description : null,
	};
}

function isValidRefreshSchedule(schedule: string | null | undefined): boolean {
	const recurringSchedule = schedule ?? null;
	return !isRecurringSchedule(recurringSchedule) || nextCronTick(recurringSchedule, new Date()) !== null;
}

function isRecurringSchedule(schedule: string | null): schedule is string {
	return schedule !== null && schedule !== NO_CACHE_SCHEDULE;
}
