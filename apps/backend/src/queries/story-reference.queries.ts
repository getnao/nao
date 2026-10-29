import { STORY_REFERENCE_TAG } from '@nao/shared';
import type { StoryFormat } from '@nao/shared/types';
import {
	aliasedTable,
	and,
	asc,
	desc,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	max,
	or,
	type SQL,
	sql,
} from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { isNotQuickQuestionChat } from './chat.queries';
import { sharedStoryGrantsUser } from './shared-story.queries';

export type ReferenceableStoryListing = {
	storyId: string;
	chatId: string | null;
	chatTitle: string | null;
	slug: string;
	title: string;
	format: StoryFormat;
	authorName: string | null;
	ownerId: string | null;
	isPinned: boolean;
	isCertified: boolean;
	isSharedWithMe: boolean;
	updatedAt: Date;
};

export type ReferenceableStory = ReferenceableStoryListing & {
	versionId: string;
	version: number;
	code: string;
};

export type ReferenceableStoryFilters = {
	trustedOnly?: boolean;
	storyIds?: string[];
	folderIds?: string[];
	sharedWithMeOnly?: boolean;
	limit?: number;
	offset?: number;
};

export type MentioningChat = {
	chatId: string;
	title: string;
	updatedAt: Date;
	isOrigin: boolean;
};

const DEFAULT_LIMIT = 20;
export const MAX_REFERENCEABLE_STORIES_LIMIT = 200;
const MAX_MENTIONING_CHATS = 10;

const storyOwner = aliasedTable(s.user, 'story_owner');

/** Lists stories pinned first, then certified, then the most recently updated and shared with the user. */
export async function listReferenceableStories(
	userId: string,
	projectId: string,
	filters: ReferenceableStoryFilters = {},
): Promise<ReferenceableStory[]> {
	const latestVersions = latestVersionsSubquery();
	const rows = await db
		.select({
			...listingColumns(),
			versionId: s.storyVersion.id,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.leftJoin(s.sharedStory, and(eq(s.sharedStory.storyId, s.story.id), eq(s.sharedStory.projectId, projectId)))
		.leftJoin(storyOwner, eq(storyOwner.id, sql`coalesce(${s.chat.userId}, ${s.story.userId})`))
		.innerJoin(latestVersions, eq(latestVersions.storyId, s.story.id))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(isReferenceable(userId, projectId, filters))
		.orderBy(...trustedThenRecent())
		.limit(Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_REFERENCEABLE_STORIES_LIMIT))
		.offset(filters.offset ?? 0)
		.execute();

	return rows.map((row) => toReferenceableStory(row, userId));
}

/** Every story the user can mention, in the same order, without the content of their latest version. */
export async function listAllReferenceableStoryListings(
	userId: string,
	projectId: string,
): Promise<ReferenceableStoryListing[]> {
	const rows = await db
		.select(listingColumns())
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.leftJoin(s.sharedStory, and(eq(s.sharedStory.storyId, s.story.id), eq(s.sharedStory.projectId, projectId)))
		.leftJoin(storyOwner, eq(storyOwner.id, sql`coalesce(${s.chat.userId}, ${s.story.userId})`))
		.where(and(isReferenceable(userId, projectId), exists(storyVersions())))
		.orderBy(...trustedThenRecent())
		.execute();

	return rows.map((row) => toReferenceableStory(row, userId));
}

export async function getReferenceableStory(
	userId: string,
	projectId: string,
	storyId: string,
): Promise<ReferenceableStory | null> {
	const [story] = await listReferenceableStories(userId, projectId, { storyIds: [storyId], limit: 1 });
	return story ?? null;
}

/** Lists the chats that created the story then visibly referenced by mention or card. */
export async function listMentioningChats(
	userId: string,
	projectId: string,
	storyId: string,
	originChatId: string | null,
): Promise<MentioningChat[]> {
	const rows = await db
		.select({ chatId: s.chat.id, title: s.chat.title, updatedAt: s.chat.updatedAt })
		.from(s.chat)
		.where(
			and(
				eq(s.chat.userId, userId),
				eq(s.chat.projectId, projectId),
				isNull(s.chat.deletedAt),
				isNotQuickQuestionChat(),
				or(originChatId ? eq(s.chat.id, originChatId) : undefined, exists(mentioningMessageParts(storyId))),
			),
		)
		.orderBy(sql`case when ${s.chat.id} = ${originChatId} then 0 else 1 end`, desc(s.chat.updatedAt))
		.limit(MAX_MENTIONING_CHATS)
		.execute();
	return rows.map((row) => ({ ...row, isOrigin: row.chatId === originChatId }));
}

function listingColumns() {
	return {
		storyId: s.story.id,
		chatId: s.story.chatId,
		chatTitle: s.chat.title,
		slug: s.story.slug,
		title: s.story.title,
		format: s.story.format,
		authorName: storyOwner.name,
		ownerId: storyOwner.id,
		isPinned: s.sharedStory.isPinned,
		shareVisibility: s.sharedStory.visibility,
		certifiedAt: s.story.certifiedAt,
		updatedAt: s.story.updatedAt,
	};
}

function toReferenceableStory<Row extends ListingRow>(
	{ isPinned, certifiedAt, shareVisibility, ...row }: Row,
	userId: string,
) {
	return {
		...row,
		isPinned: isPinned === true,
		isCertified: certifiedAt !== null,
		isSharedWithMe: shareVisibility === 'specific' && row.ownerId !== userId,
	};
}

type ListingRow = {
	ownerId: string | null;
	isPinned: boolean | null;
	certifiedAt: Date | null;
	shareVisibility: string | null;
};

function isReferenceable(userId: string, projectId: string, filters: ReferenceableStoryFilters = {}): SQL | undefined {
	return and(
		sql`coalesce(${s.story.projectId}, ${s.chat.projectId}) = ${projectId}`,
		isNull(s.story.archivedAt),
		or(isOwnedBy(userId), isSharedWith(userId)),
		filters.trustedOnly ? isTrusted() : undefined,
		filters.storyIds ? inArray(s.story.id, filters.storyIds) : undefined,
		filters.folderIds ? isInFolders(filters.folderIds) : undefined,
		filters.sharedWithMeOnly ? isSharedSpecificallyWith(userId) : undefined,
	);
}

function trustedThenRecent(): SQL[] {
	return [
		sql`case when ${eq(s.sharedStory.isPinned, true)} then 0 else 1 end`,
		sql`case when ${isNotNull(s.story.certifiedAt)} then 0 else 1 end`,
		desc(s.story.updatedAt),
		asc(s.story.id),
	];
}

function storyVersions() {
	return db.select({ id: s.storyVersion.id }).from(s.storyVersion).where(eq(s.storyVersion.storyId, s.story.id));
}

function isOwnedBy(userId: string): SQL {
	return or(eq(s.chat.userId, userId), and(isNull(s.story.chatId), eq(s.story.userId, userId)))!;
}

function isSharedWith(userId: string): SQL {
	return and(
		isNotNull(s.sharedStory.id),
		or(eq(s.sharedStory.visibility, 'project'), eq(s.sharedStory.userId, userId), sharedStoryGrantsUser(userId)),
	)!;
}

function isTrusted(): SQL {
	return or(eq(s.sharedStory.isPinned, true), isNotNull(s.story.certifiedAt))!;
}

function isInFolders(folderIds: string[]): SQL {
	return inArray(
		s.story.id,
		db
			.select({ storyId: s.storyFolderItem.storyId })
			.from(s.storyFolderItem)
			.where(inArray(s.storyFolderItem.folderId, folderIds)),
	);
}

function isSharedSpecificallyWith(userId: string): SQL {
	return and(eq(s.sharedStory.visibility, 'specific'), sharedStoryGrantsUser(userId))!;
}

function mentioningMessageParts(storyId: string) {
	const id = escapeLikePattern(storyId);
	return db
		.select({ id: s.messagePart.id })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
		.where(
			and(
				eq(s.chatMessage.chatId, s.chat.id),
				isNull(s.chatMessage.supersededAt),
				eq(s.messagePart.type, 'text'),
				or(
					and(
						eq(s.chatMessage.role, 'user'),
						sql`${s.messagePart.text} like ${`%@[story:${id}]%`} escape '\\'`,
					),
					and(
						eq(s.chatMessage.role, 'assistant'),
						sql`${s.messagePart.text} like ${`%<${STORY_REFERENCE_TAG} id="${id}"%`} escape '\\'`,
					),
				),
			),
		);
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function latestVersionsSubquery() {
	return db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.groupBy(s.storyVersion.storyId)
		.as('latest');
}
