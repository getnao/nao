import { and, desc, eq, inArray, lte, ne, or, sql } from 'drizzle-orm';

import s, {
	type ActivityTrigger,
	type ActivityType,
	type ChatVisibility,
	type DBActivity,
	type NewActivity,
	type StoryVisibility,
} from '../db/abstractSchema';
import { db } from '../db/db';

export const storyRefreshJobUniqueKey = (storyId: string): string => `story-refresh:${storyId}`;

const ACTIVITY_RUN_STALE_MS = 30 * 60 * 1_000;
const ACTIVITY_RUN_STALE_MESSAGE = 'Activity did not finish before the timeout.';

export interface CreateActivityInput {
	projectId: string;
	userId: string | null;
	type: ActivityType;
	trigger?: ActivityTrigger;
	status?: DBActivity['status'];
	storyId?: string | null;
	chatId?: string | null;
	sharedStoryId?: string | null;
	sharedChatId?: string | null;
	payload?: Record<string, unknown> | null;
}

export const createActivity = async (input: CreateActivityInput): Promise<DBActivity> => {
	const values: NewActivity = {
		projectId: input.projectId,
		userId: input.userId,
		type: input.type,
		trigger: input.trigger ?? 'system',
		status: input.status ?? 'completed',
		storyId: input.storyId ?? null,
		chatId: input.chatId ?? null,
		sharedStoryId: input.sharedStoryId ?? null,
		sharedChatId: input.sharedChatId ?? null,
		payload: input.payload ?? null,
	};
	const [created] = await db.insert(s.activity).values(values).returning().execute();
	return created;
};

/**
 * Records a `story.refreshed` activity in the `running` state and returns the
 * row so the caller can later mark it completed or failed. `userId` should be
 * the story owner so the refresh stays attached to the right actor even when
 * triggered by a non-owner (the audience is resolved from the story's shares
 * at read time).
 */
export const startStoryRefreshActivity = async (input: {
	projectId: string;
	userId: string | null;
	storyId: string;
	chatId: string | null;
	trigger: ActivityTrigger;
}): Promise<DBActivity> => {
	return createActivity({
		projectId: input.projectId,
		userId: input.userId,
		type: 'story.refreshed',
		trigger: input.trigger,
		status: 'running',
		storyId: input.storyId,
		chatId: input.chatId,
		payload: { queriesRefreshed: 0 },
	});
};

export const completeActivity = async (activityId: string, payload?: Record<string, unknown> | null): Promise<void> => {
	await db
		.update(s.activity)
		.set({ status: 'completed', completedAt: new Date(), ...(payload !== undefined && { payload }) })
		.where(and(eq(s.activity.id, activityId), eq(s.activity.status, 'running')))
		.execute();
};

export const failActivity = async (activityId: string, errorMessage: string): Promise<void> => {
	await db
		.update(s.activity)
		.set({ status: 'failed', completedAt: new Date(), errorMessage })
		.where(and(eq(s.activity.id, activityId), eq(s.activity.status, 'running')))
		.execute();
};

export const failStaleActivities = async (): Promise<number> => {
	const cutoff = new Date(Date.now() - ACTIVITY_RUN_STALE_MS);
	const rows = await db
		.update(s.activity)
		.set({ status: 'failed', completedAt: new Date(), errorMessage: ACTIVITY_RUN_STALE_MESSAGE })
		.where(and(eq(s.activity.status, 'running'), lte(s.activity.startedAt, cutoff)))
		.returning({ id: s.activity.id })
		.execute();
	return rows.length;
};

export const linkStoryScheduledJob = async (storyId: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.story).set({ scheduledJobId }).where(eq(s.story.id, storyId)).execute();
};

export interface ListActivityRow {
	activity: DBActivity;
	actorName: string | null;
	story: {
		id: string;
		slug: string;
		title: string;
		chatId: string | null;
		cacheSchedule: string | null;
		cacheScheduleDescription: string | null;
	} | null;
	chat: {
		id: string;
		title: string;
	} | null;
	storyShare: {
		id: string;
		visibility: StoryVisibility;
	} | null;
	chatShare: {
		id: string;
		visibility: ChatVisibility;
	} | null;
}

/**
 * Returns the most recent activities visible to `userId` inside `projectId`,
 * resolving the audience via JOINs on the share tables so a single activity
 * row reaches every viewer that should see it:
 *   - `story.refreshed`: the story owner, plus anyone the story is shared
 *     with (project-wide or per-user).
 *   - `story.shared` / `chat.shared`: the recipients of the share (project
 *     members or specific users), excluding the sharer themselves.
 *
 * The story/chat/share rows are eager-loaded so the feed renderer can build
 * cards without follow-up queries.
 */
export const listRecentActivities = async (
	projectId: string,
	userId: string,
	limit: number,
	types?: readonly ActivityType[],
): Promise<ListActivityRow[]> => {
	await failStaleActivities();

	const filters = [eq(s.activity.projectId, projectId), visibleToUser(projectId, userId)];
	if (types && types.length > 0) {
		filters.push(inArray(s.activity.type, [...types]));
	}

	const rows = await db
		.select({
			activity: s.activity,
			actorName: s.user.name,
			storyId: s.story.id,
			storySlug: s.story.slug,
			storyTitle: s.story.title,
			storyChatId: s.story.chatId,
			storyCacheSchedule: s.story.cacheSchedule,
			storyCacheScheduleDescription: s.story.cacheScheduleDescription,
			chatRowId: s.chat.id,
			chatTitle: s.chat.title,
			storyShareId: s.sharedStory.id,
			storyShareVisibility: s.sharedStory.visibility,
			chatShareId: s.sharedChat.id,
			chatShareVisibility: s.sharedChat.visibility,
		})
		.from(s.activity)
		.leftJoin(s.user, eq(s.user.id, s.activity.userId))
		.leftJoin(s.story, eq(s.story.id, s.activity.storyId))
		.leftJoin(s.chat, eq(s.chat.id, s.activity.chatId))
		.leftJoin(s.sharedStory, eq(s.sharedStory.id, s.activity.sharedStoryId))
		.leftJoin(s.sharedChat, eq(s.sharedChat.id, s.activity.sharedChatId))
		.where(and(...filters))
		.orderBy(desc(s.activity.startedAt))
		.limit(limit)
		.execute();

	return rows.map((row) => ({
		activity: row.activity,
		actorName: row.actorName,
		story: row.storyId
			? {
					id: row.storyId,
					slug: row.storySlug!,
					title: row.storyTitle!,
					chatId: row.storyChatId,
					cacheSchedule: row.storyCacheSchedule,
					cacheScheduleDescription: row.storyCacheScheduleDescription,
				}
			: null,
		chat: row.chatRowId
			? {
					id: row.chatRowId,
					title: row.chatTitle!,
				}
			: null,
		storyShare: row.storyShareId
			? {
					id: row.storyShareId,
					visibility: row.storyShareVisibility!,
				}
			: null,
		chatShare: row.chatShareId
			? {
					id: row.chatShareId,
					visibility: row.chatShareVisibility!,
				}
			: null,
	}));
};

/**
 * Builds the per-type audience predicate used by `listRecentActivities`.
 *
 *   - `story.refreshed`: the recorded actor (the story owner, set by both the
 *     scheduled and manual paths) plus anyone the story is shared with
 *     (project-wide or per-user). Story ownership is resolved through the
 *     story row and, for chat-based stories where `story.user_id` is null,
 *     through the underlying chat owner.
 *   - `story.shared` / `chat.shared`: the recipients of the share, excluding
 *     the sharer themselves.
 */
function visibleToUser(projectId: string, userId: string) {
	const userIsActor = eq(s.activity.userId, userId);

	const userOwnsStory = sql`EXISTS (
		SELECT 1 FROM ${s.story} st
		LEFT JOIN ${s.chat} c ON c.id = st.chat_id
		WHERE st.id = ${s.activity.storyId}
			AND (st.user_id = ${userId} OR c.user_id = ${userId})
	)`;
	const storySharedWithUser = or(
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedStory} ss
			WHERE ss.story_id = ${s.activity.storyId}
				AND ss.visibility = 'project'
				AND ss.project_id = ${projectId}
		)`,
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedStory} ss
			INNER JOIN ${s.sharedStoryAccess} ssa ON ssa.shared_story_id = ss.id
			WHERE ss.story_id = ${s.activity.storyId} AND ssa.user_id = ${userId}
		)`,
	);

	const storyShareIncludesUser = or(
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedStory} ss
			WHERE ss.id = ${s.activity.sharedStoryId}
				AND ss.visibility = 'project'
				AND ss.project_id = ${projectId}
		)`,
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedStoryAccess} ssa
			WHERE ssa.shared_story_id = ${s.activity.sharedStoryId}
				AND ssa.user_id = ${userId}
		)`,
	);

	const chatShareIncludesUser = or(
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedChat} sc
			INNER JOIN ${s.chat} c ON c.id = sc.chat_id
			WHERE sc.id = ${s.activity.sharedChatId}
				AND sc.visibility = 'project'
				AND c.project_id = ${projectId}
		)`,
		sql`EXISTS (
			SELECT 1 FROM ${s.sharedChatAccess} sca
			WHERE sca.shared_chat_id = ${s.activity.sharedChatId}
				AND sca.user_id = ${userId}
		)`,
	);

	return or(
		and(eq(s.activity.type, 'story.refreshed'), or(userIsActor, userOwnsStory, storySharedWithUser)),
		and(eq(s.activity.type, 'story.shared'), ne(s.activity.userId, userId), storyShareIncludesUser),
		and(eq(s.activity.type, 'chat.shared'), ne(s.activity.userId, userId), chatShareIncludesUser),
	);
}
