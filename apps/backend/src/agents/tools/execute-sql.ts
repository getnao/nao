import { sqlIncludesFilterTemplate, stripSqlFilterBlocks, validateSqlFilterTemplate } from '@nao/shared/sql-template';
import type { executeSql } from '@nao/shared/tools';
import { executeSql as schemas, LOCAL_DATABASE_ID } from '@nao/shared/tools';

import { ExecuteSqlOutput, renderToModelOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import { getExecuteSqlPartByQueryIdInChat, updateExecuteSqlPart } from '../../queries/execute-sql.queries';
import { resolveExcludedColumnEnforcement } from '../../services/excluded-columns.service';
import { runQueryOnLocalFiles } from '../../services/local-query.service';
import { ToolContext } from '../../types/tools';
import { detectQueryRowLimit, isReadOnlySqlQuery } from '../../utils/sql-filter';
import { createTool } from '../../utils/tools';
import { queryAppDb } from './query-app-db';

export async function executeQuery(
	{ sql_query, database_id, query_id, save_to }: executeSql.Input,
	context: ToolContext,
): Promise<executeSql.Output> {
	const templateWarnings = env.BETA_STORY_FILTERS_ENABLED ? validateSqlFilterTemplate(sql_query) : [];
	const effectiveSql = stripSqlFilterBlocks(sql_query);
	if (templateWarnings.length > 0 && sqlIncludesFilterTemplate(effectiveSql)) {
		throw new Error(`Invalid story filter SQL template: ${templateWarnings.join(' ')}`);
	}
	const writePermEnabled = context.agentSettings?.sql?.dangerouslyWritePermEnabled ?? false;
	if (!writePermEnabled && !(await isReadOnlySqlQuery(effectiveSql))) {
		throw new Error(
			'Write SQL operations are disabled. Only SELECT queries are allowed. ' +
				'Enable "Dangerous write permissions" in the admin panel to allow INSERT, UPDATE, DELETE and DDL queries.',
		);
	}

	if (save_to && context.adminMode) {
		throw new Error('save_to is unavailable in admin mode. Run the query without save_to.');
	}

	if (save_to && database_id !== LOCAL_DATABASE_ID) {
		throw new Error(
			`save_to only works with the "${LOCAL_DATABASE_ID}" database. To keep a warehouse result, re-run it against ${LOCAL_DATABASE_ID} as "SELECT * FROM <query_id>".`,
		);
	}

	if (context.adminMode) {
		return withTemplateWarnings(await executeAppDbQuery(effectiveSql, context, query_id), templateWarnings);
	}

	if (database_id === LOCAL_DATABASE_ID) {
		return withTemplateWarnings(
			await executeLocalQuery(effectiveSql, context, query_id, save_to),
			templateWarnings,
		);
	}

	const enforceExcludedColumns = await resolveExcludedColumnEnforcement(context.agentSettings);
	const naoProjectFolder = context.projectFolder;
	const envVars = context.envVars;
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/execute_sql`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			sql: effectiveSql,
			nao_project_folder: naoProjectFolder,
			enforce_excluded_columns: enforceExcludedColumns,
			...(database_id && { database_id }),
			...(Object.keys(envVars).length > 0 && { env_vars: envVars }),
			...(context.azureAccessToken && { azure_access_token: context.azureAccessToken }),
		}),
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(`Error executing SQL query: ${JSON.stringify(errorData.detail)}`);
	}

	const data = await response.json();
	const id = query_id ?? (`query_${crypto.randomUUID().slice(0, 8)}` as const);

	context.queryResults.set(id, { columns: data.columns, data: data.data });

	const appliedLimit = detectQueryRowLimit(effectiveSql);

	return withTemplateWarnings(
		{
			_version: '1',
			...data,
			id,
			...(appliedLimit !== null && { applied_limit: appliedLimit }),
		},
		templateWarnings,
	);
}

/** Files and earlier results, in nao's own DuckDB. No warehouse is involved. */
async function executeLocalQuery(
	sqlQuery: string,
	context: ToolContext,
	queryId?: `query_${string}`,
	saveTo?: executeSql.SaveTo,
): Promise<executeSql.Output> {
	const {
		result: { columns, data },
		savedFile,
	} = await runQueryOnLocalFiles(sqlQuery, context, saveTo);
	const id = queryId ?? (`query_${crypto.randomUUID().slice(0, 8)}` as const);
	context.queryResults.set(id, { columns, data });
	const appliedLimit = detectQueryRowLimit(sqlQuery);

	return {
		_version: '1',
		data,
		row_count: data.length,
		columns,
		id,
		dialect: 'duckdb',
		...(appliedLimit !== null && { applied_limit: appliedLimit }),
		...(savedFile && { saved_file: savedFile }),
	};
}

async function executeAppDbQuery(
	sqlQuery: string,
	context: ToolContext,
	queryId?: `query_${string}`,
): Promise<executeSql.Output> {
	const { columns, rows } = await queryAppDb(context.projectId, sqlQuery);
	const id = queryId ?? (`query_${crypto.randomUUID().slice(0, 8)}` as const);
	context.queryResults.set(id, { columns, data: rows });
	const appliedLimit = detectQueryRowLimit(sqlQuery);
	return {
		_version: '1',
		data: rows,
		row_count: rows.length,
		columns,
		id,
		...(appliedLimit !== null && { applied_limit: appliedLimit }),
	};
}

function withTemplateWarnings(output: executeSql.Output, templateWarnings: string[]): executeSql.Output {
	if (templateWarnings.length === 0) {
		return output;
	}
	return { ...output, template_warnings: templateWarnings };
}

async function updateExistingQuery(
	input: executeSql.Input & { query_id: `query_${string}` },
	context: ToolContext,
): Promise<executeSql.Output> {
	const existing = await getExecuteSqlPartByQueryIdInChat(context.chatId, input.query_id);
	if (!existing) {
		throw new Error(
			`Query ${input.query_id} not found in this chat. Use execute_sql without query_id to create a new query.`,
		);
	}

	const saveTo = input.save_to ?? existing.toolInput.save_to;
	const nextInput: executeSql.Input = {
		sql_query: input.sql_query,
		database_id: input.database_id ?? existing.toolInput.database_id,
		name: input.name ?? existing.toolInput.name,
		...(saveTo && { save_to: saveTo }),
	};

	const output = await executeQuery({ ...nextInput, query_id: input.query_id }, context);
	await updateExecuteSqlPart(existing.toolCallId, nextInput, output);
	return output;
}

function buildExecuteSqlToolDescription() {
	return [
		'Execute a SQL query against the connected database and return the results. If multiple databases are configured, specify the database_id.',
		...(env.BETA_STORY_FILTERS_ENABLED
			? [
					'Story filters may be embedded as SQL template blocks that are stripped when this tool runs in chat.',
					'Correct syntax: WHERE 1 = 1 {% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}.',
					"For date_range filters, {{ filters.<id>.sql }} already expands to 'start' AND 'end', so write: {% filter period %} AND order_date BETWEEN {{ filters.period.sql }} {% endfilter %}.",
					'Never use filters.<id>.start, .end, .value, or placeholders outside {% filter %} blocks — placeholders outside blocks are rejected; other invalid templates return template_warnings.',
					'Prefer query_id when adding story filter templates so existing <chart>/<table> tags keep working.',
				]
			: []),
		'To edit a previous query in-place (keep the same query_id for charts/stories), pass query_id from an earlier execute_sql result.',
	].join(' ');
}

export default createTool<executeSql.Input, executeSql.Output>({
	description: buildExecuteSqlToolDescription(),
	inputSchema: schemas.InputSchema,
	outputSchema: schemas.OutputSchema,
	execute: async (input, context) => {
		if (input.query_id) {
			return updateExistingQuery({ ...input, query_id: input.query_id }, context);
		}
		return executeQuery(input, context);
	},
	toModelOutput: ({ output }) => renderToModelOutput(ExecuteSqlOutput({ output }), output),
});
