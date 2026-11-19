import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import { renderSqlQueryTag, type SqlQueryTagConfig, type SqlQueryTagVariables } from '@nao/shared/sql-query-tag';

import { getUser } from '../queries/user.queries';
import type { AgentSettings } from '../types/agent-settings';
import type { MessageSource } from '../types/chat';
import { extractConfiguredDatabases, extractConfiguredSqlQueryTag } from '../utils/nao-config';

/** Where a warehouse query comes from: an agent run of that source, a story being displayed or an edit of its SQL. */
export type SqlQuerySource = MessageSource | 'story' | 'sqlEditor';

/** The tag of every warehouse query of a run, missing only the database each query targets. */
export interface RunSqlQueryTag {
	config: SqlQueryTagConfig;
	variables: Omit<SqlQueryTagVariables, 'database_id'>;
	/** The database of a query that names none, known when the project has a single one. */
	defaultDatabaseId: string;
}

/** The tag in effect for a project, or null when its queries are not tagged. nao_config.yaml wins over the admin settings. */
export function resolveSqlQueryTagConfig(
	projectFolder: string,
	agentSettings: AgentSettings | null,
): SqlQueryTagConfig | null {
	const configured = extractConfiguredSqlQueryTag(projectFolder);
	if (configured) {
		return configured;
	}
	const queryTag = agentSettings?.sql?.queryTag;
	if (!queryTag?.enabled || queryTag.template.trim() === '') {
		return null;
	}
	return { template: queryTag.template, position: queryTag.position };
}

export async function buildRunSqlQueryTag(run: {
	projectFolder: string;
	agentSettings: AgentSettings | null;
	projectId: string;
	userId: string;
	chatId?: string | null;
	source: SqlQuerySource;
	groupAccess: UserRulesGroupAccess;
}): Promise<RunSqlQueryTag | null> {
	const config = resolveSqlQueryTagConfig(run.projectFolder, run.agentSettings);
	if (!config) {
		return null;
	}
	const user = await getUser({ id: run.userId });
	return {
		config,
		variables: {
			user_id: run.userId,
			user_email: user?.email ?? '',
			user_groups: run.groupAccess.enforced ? run.groupAccess.groupNames.join(',') : '',
			project_id: run.projectId,
			chat_id: run.chatId ?? '',
			source: run.source,
		},
		defaultDatabaseId: resolveDefaultDatabaseId(run.projectFolder),
	};
}

export function resolveDefaultDatabaseId(projectFolder: string): string {
	const databases = extractConfiguredDatabases(projectFolder);
	return databases.length === 1 ? databases[0].id : '';
}

/** The `query_tag` of a warehouse request, left out when the comment renders empty. */
export function serializeRunSqlQueryTag(tag: RunSqlQueryTag, databaseId: string | undefined) {
	const comment = renderSqlQueryTag(tag.config.template, {
		...tag.variables,
		database_id: databaseId ?? tag.defaultDatabaseId,
	});
	return comment ? { comment, position: tag.config.position } : undefined;
}
