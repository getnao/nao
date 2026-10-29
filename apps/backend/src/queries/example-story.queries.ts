import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';

import s from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { JAFFLE_SHOP_STORY } from '../fixtures/jaffle-shop-story';

export const SYSTEM_EXAMPLE_USER_ID = 'system-example-user';
export const SYSTEM_EXAMPLE_CHAT_ID = 'system-example-story-chat';
export const SYSTEM_EXAMPLE_STORY_ID = 'system-example-story';

const SYSTEM_EXAMPLE_MESSAGE_ID = 'system-example-story-message';
const SYSTEM_EXAMPLE_VERSION_ID = 'system-example-story-version';
const SYSTEM_EXAMPLE_SHARE_ID = 'system-example-story-share';

export async function upsertSystemExampleStory(): Promise<void> {
	if (dbConfig.dialect === Dialect.Postgres) {
		await db.transaction((transaction) => runPostgresSeed(transaction));
		return;
	}

	db.transaction((transaction) => {
		for (const statement of buildSeedStatements(transaction)) {
			statement.run();
		}
	});
}

async function runPostgresSeed(transaction: DBTransaction): Promise<void> {
	for (const statement of buildSeedStatements(transaction)) {
		await statement.execute();
	}
}

function buildSeedStatements(executor: DBExecutor) {
	const now = new Date();
	const statements = [
		executor
			.insert(s.user)
			.values({
				id: SYSTEM_EXAMPLE_USER_ID,
				name: 'Nao',
				email: 'system-example@getnao.invalid',
				emailVerified: true,
				memoryEnabled: false,
			})
			.onConflictDoUpdate({
				target: s.user.id,
				set: {
					name: 'Nao',
					email: 'system-example@getnao.invalid',
					emailVerified: true,
					memoryEnabled: false,
					updatedAt: now,
				},
			}),
		executor
			.insert(s.chat)
			.values({
				id: SYSTEM_EXAMPLE_CHAT_ID,
				userId: SYSTEM_EXAMPLE_USER_ID,
				projectId: SYSTEM_EXAMPLE_PROJECT_ID,
				title: JAFFLE_SHOP_STORY.title,
			})
			.onConflictDoUpdate({
				target: s.chat.id,
				set: {
					userId: SYSTEM_EXAMPLE_USER_ID,
					projectId: SYSTEM_EXAMPLE_PROJECT_ID,
					title: JAFFLE_SHOP_STORY.title,
					deletedAt: null,
					updatedAt: now,
				},
			}),
		executor
			.insert(s.story)
			.values({
				id: SYSTEM_EXAMPLE_STORY_ID,
				chatId: SYSTEM_EXAMPLE_CHAT_ID,
				slug: JAFFLE_SHOP_STORY.slug,
				title: JAFFLE_SHOP_STORY.title,
				format: JAFFLE_SHOP_STORY.format,
			})
			.onConflictDoUpdate({
				target: s.story.id,
				set: {
					chatId: SYSTEM_EXAMPLE_CHAT_ID,
					slug: JAFFLE_SHOP_STORY.slug,
					title: JAFFLE_SHOP_STORY.title,
					format: JAFFLE_SHOP_STORY.format,
					archivedAt: null,
					updatedAt: now,
				},
			}),
		executor
			.insert(s.storyVersion)
			.values({
				id: SYSTEM_EXAMPLE_VERSION_ID,
				storyId: SYSTEM_EXAMPLE_STORY_ID,
				version: 1,
				code: JAFFLE_SHOP_STORY.code,
				action: 'create',
				source: 'assistant',
			})
			.onConflictDoUpdate({
				target: s.storyVersion.id,
				set: {
					storyId: SYSTEM_EXAMPLE_STORY_ID,
					version: 1,
					code: JAFFLE_SHOP_STORY.code,
					action: 'create',
					source: 'assistant',
				},
			}),
		executor
			.insert(s.chatMessage)
			.values({
				id: SYSTEM_EXAMPLE_MESSAGE_ID,
				chatId: SYSTEM_EXAMPLE_CHAT_ID,
				role: 'assistant',
			})
			.onConflictDoUpdate({
				target: s.chatMessage.id,
				set: {
					chatId: SYSTEM_EXAMPLE_CHAT_ID,
					role: 'assistant',
					supersededAt: null,
				},
			}),
		...Object.entries(JAFFLE_SHOP_STORY.queries).map(([queryId, query], order) =>
			executor
				.insert(s.messagePart)
				.values({
					id: `system-example-story-part-${queryId}`,
					messageId: SYSTEM_EXAMPLE_MESSAGE_ID,
					order,
					type: 'tool-execute_sql',
					toolCallId: `system-example-story-tool-${queryId}`,
					toolName: 'execute_sql',
					toolState: 'output-available',
					toolInput: {
						sql_query: query.sql,
						database_id: LOCAL_DATABASE_ID,
						name: query.name,
					},
					toolOutput: {
						_version: '1',
						id: queryId,
						dialect: 'duckdb',
						columns: query.columns,
						data: query.data,
						row_count: query.data.length,
					},
				})
				.onConflictDoUpdate({
					target: s.messagePart.id,
					set: {
						messageId: SYSTEM_EXAMPLE_MESSAGE_ID,
						order,
						type: 'tool-execute_sql',
						toolCallId: `system-example-story-tool-${queryId}`,
						toolName: 'execute_sql',
						toolState: 'output-available',
						toolInput: {
							sql_query: query.sql,
							database_id: LOCAL_DATABASE_ID,
							name: query.name,
						},
						toolOutput: {
							_version: '1',
							id: queryId,
							dialect: 'duckdb',
							columns: query.columns,
							data: query.data,
							row_count: query.data.length,
						},
					},
				}),
		),
		executor
			.insert(s.sharedStory)
			.values({
				id: SYSTEM_EXAMPLE_SHARE_ID,
				storyId: SYSTEM_EXAMPLE_STORY_ID,
				projectId: SYSTEM_EXAMPLE_PROJECT_ID,
				userId: SYSTEM_EXAMPLE_USER_ID,
				visibility: 'project',
				isPinned: true,
			})
			.onConflictDoUpdate({
				target: s.sharedStory.id,
				set: {
					storyId: SYSTEM_EXAMPLE_STORY_ID,
					projectId: SYSTEM_EXAMPLE_PROJECT_ID,
					userId: SYSTEM_EXAMPLE_USER_ID,
					visibility: 'project',
					isPinned: true,
				},
			}),
	];

	return statements;
}
