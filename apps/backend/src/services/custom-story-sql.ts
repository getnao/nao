import { renderSqlTemplate } from '@nao/shared/sql-template';
import type { StoryQueryResult, StorySqlRequest } from '@nao/shared/story-app';
import { type StoryQueryFilters, toStoryFilterBindings, withInactiveFilterSpecs } from '@nao/shared/story-query-inputs';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';

import { containsBlockedPassthroughCall, isReadOnlySqlQuery } from '../utils/sql-filter';
import { buildToolContext } from './agent';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';
import { resolveExcludedColumnEnforcement } from './excluded-columns.service';
import { executeRawSql } from './live-story';
import { isWarehouseSqlEnabled } from './semantic-layer.service';
import { WarehouseSqlError } from './warehouse-sql.service';

export const MAX_CUSTOM_STORY_SQL_LENGTH = 100_000;

export interface CustomStorySqlTarget {
	projectId: string;
	chatId: string;
	/** The user looking at the story: the SQL runs with their access, never with the story owner's. */
	viewerId: string;
	billingAccessVerifiedProjectId?: string;
}

/** Rejected SQL is the story's content, like a failing query: its reason reaches the frame. */
export class CustomStorySqlError extends Error {}

/**
 * Runs SQL a custom story wrote itself, as the viewer: read-only, on the warehouse only, under the viewer's table
 * access, row security and excluded columns, and only where the project allows raw SQL on the warehouse.
 */
export async function runCustomStorySql(
	target: CustomStorySqlTarget,
	{ sql: template, databaseId, filters }: StorySqlRequest,
): Promise<StoryQueryResult> {
	const sql = renderStorySqlFilters(template, filters);
	await assertStorySqlAllowed(sql, databaseId);
	const toolContext = await buildToolContext({
		projectId: target.projectId,
		userId: target.viewerId,
		chatId: target.chatId,
	});
	if (!isWarehouseSqlEnabled(toolContext.semanticLayerMode)) {
		throw new CustomStorySqlError(
			'Raw SQL on the warehouse is disabled in this project: stories read it through their saved queries.',
		);
	}

	if (target.billingAccessVerifiedProjectId !== target.projectId) {
		await assertProjectCloudBillingAccess(target.projectId);
	}
	const executionContext = {
		toolContext,
		enforceExcludedColumns: await resolveExcludedColumnEnforcement(target.projectId, toolContext.agentSettings),
	};

	try {
		const result = await executeRawSql(sql, {
			executionContext,
			databaseId,
			billingAccessVerifiedProjectId: target.projectId,
		});
		return { columns: result.columns, data: result.data };
	} catch (error) {
		throw error instanceof WarehouseSqlError ? new CustomStorySqlError(error.message) : error;
	}
}

function renderStorySqlFilters(sql: string, filters: StoryQueryFilters | undefined): string {
	const { selections, specs } = toStoryFilterBindings(filters);
	try {
		return renderSqlTemplate(sql, selections, withInactiveFilterSpecs(sql, specs));
	} catch (error) {
		throw new CustomStorySqlError(error instanceof Error ? error.message : String(error));
	}
}

async function assertStorySqlAllowed(sql: string, databaseId: string | undefined): Promise<void> {
	if (databaseId === LOCAL_DATABASE_ID) {
		throw new CustomStorySqlError(
			`Stories run SQL on the warehouse only, not on "${LOCAL_DATABASE_ID}": read saved results with useQueryData.`,
		);
	}
	if (containsBlockedPassthroughCall(sql)) {
		throw new CustomStorySqlError('Stories cannot call catalog or server-passthrough functions.');
	}
	if (!(await isReadOnlySqlQuery(sql))) {
		throw new CustomStorySqlError('Stories can only run read-only SQL (SELECT).');
	}
}
