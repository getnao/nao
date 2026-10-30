import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import s, { type DBOrganizationSeatState, type NewNotification } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

type EmailNotificationChannel = 'owner_email' | 'admin_email';

export async function listScheduledWorkResourcesForOwner(
	orgId: string,
	userId: string,
): Promise<Array<{ type: string; id: string | null; projectId: string }>> {
	const [automations, stories, deliveries] = await Promise.all([
		db
			.select({ id: s.automation.id, projectId: s.automation.projectId })
			.from(s.automation)
			.innerJoin(s.project, eq(s.project.id, s.automation.projectId))
			.where(
				and(
					eq(s.project.orgId, orgId),
					eq(s.automation.userId, userId),
					isNotNull(s.automation.scheduledJobId),
				),
			)
			.execute(),
		db
			.select({ id: s.story.id, projectId: s.story.projectId })
			.from(s.story)
			.innerJoin(s.project, eq(s.project.id, s.story.projectId))
			.where(and(eq(s.project.orgId, orgId), eq(s.story.userId, userId), isNotNull(s.story.scheduledJobId)))
			.execute(),
		db
			.select({ id: s.storyDelivery.id, projectId: s.storyDelivery.projectId })
			.from(s.storyDelivery)
			.innerJoin(s.story, eq(s.story.id, s.storyDelivery.storyId))
			.innerJoin(s.project, eq(s.project.id, s.storyDelivery.projectId))
			.where(
				and(
					eq(s.project.orgId, orgId),
					eq(s.story.userId, userId),
					eq(s.storyDelivery.enabled, true),
					isNotNull(s.storyDelivery.scheduledJobId),
				),
			)
			.execute(),
	]);
	return [
		...automations.map(({ id, projectId }) => ({ type: 'automation', id, projectId })),
		...stories.flatMap(({ id, projectId }) => (projectId ? [{ type: 'story.refresh', id, projectId }] : [])),
		...deliveries.flatMap(({ id, projectId }) => (projectId ? [{ type: 'story.delivery', id, projectId }] : [])),
	];
}

export async function listOrganizationSeatStates(orgId: string): Promise<DBOrganizationSeatState[]> {
	return db.select().from(s.organizationSeatState).where(eq(s.organizationSeatState.orgId, orgId)).execute();
}

export async function setOrganizationSeatSelection(
	orgId: string,
	userId: string,
	selectedAt: Date | null,
): Promise<DBOrganizationSeatState> {
	const [state] = await db
		.insert(s.organizationSeatState)
		.values({ orgId, userId, selectedAt })
		.onConflictDoUpdate({
			target: [s.organizationSeatState.orgId, s.organizationSeatState.userId],
			set: { selectedAt },
		})
		.returning()
		.execute();
	return state;
}

export async function syncOrganizationSeatState(input: {
	orgId: string;
	userId: string;
	isReadOnly: boolean;
	changedAt: Date;
}): Promise<{ state: DBOrganizationSeatState; changed: boolean }> {
	const stateChanged = sql`${s.organizationSeatState.isReadOnly} <> excluded.is_read_only`;
	const [state] = await db
		.insert(s.organizationSeatState)
		.values({
			orgId: input.orgId,
			userId: input.userId,
			isReadOnly: input.isReadOnly,
			stateChangedAt: input.changedAt,
		})
		.onConflictDoUpdate({
			target: [s.organizationSeatState.orgId, s.organizationSeatState.userId],
			set: {
				isReadOnly: input.isReadOnly,
				stateChangedAt: sql`case when ${stateChanged} then excluded.state_changed_at else ${s.organizationSeatState.stateChangedAt} end`,
				ownerInAppNotifiedAt: sql`case when ${stateChanged} then null else ${s.organizationSeatState.ownerInAppNotifiedAt} end`,
				ownerEmailNotifiedAt: sql`case when ${stateChanged} then null else ${s.organizationSeatState.ownerEmailNotifiedAt} end`,
				adminEmailNotifiedAt: sql`case when ${stateChanged} then null else ${s.organizationSeatState.adminEmailNotifiedAt} end`,
			},
		})
		.returning()
		.execute();
	return { state, changed: state.stateChangedAt?.getTime() === input.changedAt.getTime() };
}

export async function claimPausedWorkInAppNotification(
	orgId: string,
	userId: string,
	notification: Omit<NewNotification, 'category' | 'userId'>,
	claimedAt = new Date(),
): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) =>
				claimPausedWorkInAppNotificationSqlite(transaction, orgId, userId, notification, claimedAt),
			{ behavior: 'immediate' },
		);
	}
	return db.transaction(async (transaction) => {
		const [claimed] = await claimPausedWorkInAppNotificationUpdate(transaction, orgId, userId, claimedAt).execute();
		if (!claimed) {
			return false;
		}
		await transaction
			.insert(s.notification)
			.values({ ...notification, userId, category: 'scheduled_work_paused' })
			.execute();
		return true;
	});
}

function claimPausedWorkInAppNotificationSqlite(
	transaction: DBExecutor,
	orgId: string,
	userId: string,
	notification: Omit<NewNotification, 'category' | 'userId'>,
	claimedAt: Date,
): boolean {
	const [claimed] = claimPausedWorkInAppNotificationUpdate(transaction, orgId, userId, claimedAt).all();
	if (!claimed) {
		return false;
	}
	transaction
		.insert(s.notification)
		.values({ ...notification, userId, category: 'scheduled_work_paused' })
		.run();
	return true;
}

function claimPausedWorkInAppNotificationUpdate(executor: DBExecutor, orgId: string, userId: string, claimedAt: Date) {
	return executor
		.update(s.organizationSeatState)
		.set({ ownerInAppNotifiedAt: claimedAt })
		.where(
			and(
				eq(s.organizationSeatState.orgId, orgId),
				eq(s.organizationSeatState.userId, userId),
				eq(s.organizationSeatState.isReadOnly, true),
				isNull(s.organizationSeatState.ownerInAppNotifiedAt),
			),
		)
		.returning({ userId: s.organizationSeatState.userId });
}

export async function claimOrganizationSeatEmailNotification(
	orgId: string,
	userId: string,
	channel: EmailNotificationChannel,
	claimedAt = new Date(),
): Promise<boolean> {
	const timestamp =
		channel === 'owner_email'
			? s.organizationSeatState.ownerEmailNotifiedAt
			: s.organizationSeatState.adminEmailNotifiedAt;
	const set = channel === 'owner_email' ? { ownerEmailNotifiedAt: claimedAt } : { adminEmailNotifiedAt: claimedAt };
	const [claimed] = await db
		.update(s.organizationSeatState)
		.set(set)
		.where(
			and(
				eq(s.organizationSeatState.orgId, orgId),
				eq(s.organizationSeatState.userId, userId),
				eq(s.organizationSeatState.isReadOnly, true),
				isNull(timestamp),
			),
		)
		.returning({ userId: s.organizationSeatState.userId })
		.execute();
	return Boolean(claimed);
}

export async function releaseOrganizationSeatEmailNotification(
	orgId: string,
	userId: string,
	channel: EmailNotificationChannel,
	claimedAt: Date,
): Promise<boolean> {
	const timestamp =
		channel === 'owner_email'
			? s.organizationSeatState.ownerEmailNotifiedAt
			: s.organizationSeatState.adminEmailNotifiedAt;
	const set = channel === 'owner_email' ? { ownerEmailNotifiedAt: null } : { adminEmailNotifiedAt: null };
	const [released] = await db
		.update(s.organizationSeatState)
		.set(set)
		.where(
			and(
				eq(s.organizationSeatState.orgId, orgId),
				eq(s.organizationSeatState.userId, userId),
				eq(s.organizationSeatState.isReadOnly, true),
				eq(timestamp, claimedAt),
			),
		)
		.returning({ userId: s.organizationSeatState.userId })
		.execute();
	return Boolean(released);
}
