import { sqlIncludesFilterTemplate, stripSqlFilterBlocks, validateSqlFilterTemplate } from '@nao/shared/sql-template';
import type { executeSql } from '@nao/shared/tools';
import { executeSql as schemas, LOCAL_DATABASE_ID } from '@nao/shared/tools';

import { ExecuteSqlOutput, renderToModelOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import {
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME,
	getExecuteSqlPartByQueryIdInChat,
	updateExecuteSqlPart,
} from '../../queries/execute-sql.queries';
import { resolveExcludedColumnEnforcement } from '../../services/excluded-columns.service';
import { runQueryOnLocalFiles } from '../../services/local-query.service';
import { getQueryResult } from '../../services/query-result.service';
import { isWarehouseSqlEnabled } from '../../services/semantic-layer.service';
import {
	executeWarehouseSql,
	type WarehouseQueryParameter,
	type WarehouseQueryParameterValue,
} from '../../services/warehouse-sql.service';
import { ToolContext } from '../../types/tools';
import { containsBlockedPassthroughCall, detectQueryRowLimit, isReadOnlySqlQuery } from '../../utils/sql-filter';
import { createTool } from '../../utils/tools';
import { queryAppDb } from './query-app-db';

type ExecuteQueryOptions = {
	/** SQL compiled by the semantic layer may reach the warehouse even when hand-written SQL may not. */
	compiledBySemanticLayer?: boolean;
};

export async function executeQuery(
	{ sql_query, database_id, query_id, save_to, array_parameters }: executeSql.Input,
	context: ToolContext,
	options: ExecuteQueryOptions = {},
): Promise<executeSql.Output> {
	if (!options.compiledBySemanticLayer) {
		assertWarehouseSqlAllowed(database_id, context);
	}
	const templateWarnings = env.BETA_STORY_FILTERS_ENABLED ? validateSqlFilterTemplate(sql_query) : [];
	const effectiveSql = stripSqlFilterBlocks(sql_query);
	if (templateWarnings.length > 0 && sqlIncludesFilterTemplate(effectiveSql)) {
		throw new Error(`Invalid story filter SQL template: ${templateWarnings.join(' ')}`);
	}
	if (containsBlockedPassthroughCall(effectiveSql)) {
		throw new Error(
			'Query calls a catalog/server-passthrough function (e.g. postgres_query, mysql_query, sqlite_query) — ' +
				"blocked regardless of write permissions, since these open a connection to another server rather than write to this database's data.",
		);
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

	if (array_parameters?.length && (context.adminMode || database_id === LOCAL_DATABASE_ID)) {
		throw new Error('array_parameters only work with a BigQuery warehouse.');
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
	const queryParameters = await resolveArrayParameters(array_parameters, context, effectiveSql);
	const data = await executeWarehouseSql(effectiveSql, {
		projectFolder: context.projectFolder,
		databaseId: database_id,
		envVars: context.envVars,
		azureAccessToken: context.azureAccessToken,
		queryParameters,
		enforceExcludedColumns,
		tableAccess: context.warehouseTableAccess,
		rowSecurity: context.warehouseRowSecurity ?? { enforced: false },
	});
	const id = query_id ?? (`query_${crypto.randomUUID().slice(0, 8)}` as const);
	const appliedLimit = detectQueryRowLimit(effectiveSql);

	context.queryResults.set(id, {
		columns: data.columns,
		data: data.data,
		...(appliedLimit !== null && { appliedLimit }),
		...(options.compiledBySemanticLayer && { compiledBySemanticLayer: true }),
	});

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
		result: { columns, data, decimalColumns },
		savedFile,
	} = await runQueryOnLocalFiles(sqlQuery, context, saveTo);
	const id = queryId ?? (`query_${crypto.randomUUID().slice(0, 8)}` as const);
	const appliedLimit = detectQueryRowLimit(sqlQuery);
	context.queryResults.set(id, {
		columns,
		data,
		...(decimalColumns && { decimalColumns }),
		...(appliedLimit !== null && { appliedLimit }),
	});

	return {
		_version: '1',
		data,
		row_count: data.length,
		columns,
		...(decimalColumns && { decimal_columns: decimalColumns }),
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
	const appliedLimit = detectQueryRowLimit(sqlQuery);
	context.queryResults.set(id, { columns, data: rows, ...(appliedLimit !== null && { appliedLimit }) });
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
		return updateSameTurnQuery(input, context);
	}
	if (existing.toolName === EXECUTE_SEMANTIC_QUERY_TOOL_NAME) {
		throw semanticQueryNotEditableError(input.query_id);
	}

	const saveTo = input.save_to ?? existing.toolInput.save_to;
	const arrayParameters = input.array_parameters ?? existing.toolInput.array_parameters;
	const nextInput: executeSql.Input = {
		sql_query: input.sql_query,
		database_id: input.database_id ?? existing.toolInput.database_id,
		name: input.name ?? existing.toolInput.name,
		...(saveTo && { save_to: saveTo }),
		...(arrayParameters && { array_parameters: arrayParameters }),
	};

	const output = await executeQuery({ ...nextInput, query_id: input.query_id }, context);
	await updateExecuteSqlPart(existing.toolCallId, nextInput, output);
	return output;
}

/**
 * A query created earlier in the current turn is not persisted yet: it only lives in
 * the in-memory results. Re-running it under the same id is enough, the new part is
 * saved with the rest of the turn and wins over the older one as the latest.
 */
async function updateSameTurnQuery(
	input: executeSql.Input & { query_id: `query_${string}` },
	context: ToolContext,
): Promise<executeSql.Output> {
	const sameTurnResult = context.queryResults.get(input.query_id);
	if (!sameTurnResult) {
		throw new Error(
			`Query ${input.query_id} not found in this chat. Use execute_sql without query_id to create a new query.`,
		);
	}
	if (sameTurnResult.compiledBySemanticLayer) {
		throw semanticQueryNotEditableError(input.query_id);
	}
	return executeQuery(input, context);
}

function semanticQueryNotEditableError(queryId: string): Error {
	return new Error(
		`Query ${queryId} is a semantic query and cannot be edited as SQL. Call execute_semantic_query again with the adjusted metrics, group_by or where.`,
	);
}

const MAX_BIGQUERY_PARAMETER_REQUEST_BYTES = 9 * 1024 * 1024;

async function resolveArrayParameters(
	parameters: executeSql.Input['array_parameters'],
	context: ToolContext,
	sql: string,
): Promise<WarehouseQueryParameter[] | undefined> {
	if (!parameters?.length) {
		return undefined;
	}

	const names = new Set<string>();
	const resolved = await Promise.all(
		parameters.map(async (parameter): Promise<WarehouseQueryParameter> => {
			if (names.has(parameter.name)) {
				throw new Error(`Duplicate BigQuery array parameter: ${parameter.name}`);
			}
			names.add(parameter.name);

			const result = await getQueryResult(context, parameter.query_id);
			if (!result) {
				throw new Error(`Query ${parameter.query_id} not found in this chat.`);
			}
			if (
				result.appliedLimit !== undefined &&
				result.appliedLimit > 0 &&
				result.data.length >= result.appliedLimit
			) {
				throw new Error(
					`Query ${parameter.query_id} may be truncated by LIMIT ${result.appliedLimit}. Rerun the source query without LIMIT before using it as a BigQuery array parameter.`,
				);
			}
			if (!result.columns.includes(parameter.column)) {
				throw new Error(
					`Column "${parameter.column}" not found in query ${parameter.query_id}. Available columns: ${result.columns.join(', ')}`,
				);
			}

			const values = uniqueParameterValues(
				result.data.map((row) => row[parameter.column]),
				parameter.type,
				parameter.name,
			);
			return { name: parameter.name, type: parameter.type, values };
		}),
	);

	const requestBytes = bigQueryRequestBytes(sql, resolved);
	if (requestBytes > MAX_BIGQUERY_PARAMETER_REQUEST_BYTES) {
		throw new Error(
			`BigQuery array parameters are ${Math.ceil(requestBytes / (1024 * 1024))} MB, above nao's 9 MB safety limit. Use a smaller filter file or a BigQuery staging table.`,
		);
	}
	return resolved;
}

function bigQueryRequestBytes(sql: string, parameters: WarehouseQueryParameter[]): number {
	const queryParameters = parameters.map((parameter) => ({
		name: parameter.name,
		parameterType: { type: 'ARRAY', arrayType: { type: parameter.type } },
		parameterValue: {
			arrayValues: parameter.values.map((value) => ({
				value: parameter.type === 'JSON' ? JSON.stringify(value) : String(value),
			})),
		},
	}));
	return new TextEncoder().encode(JSON.stringify({ query: sql, queryParameters })).byteLength;
}

function uniqueParameterValues(
	values: unknown[],
	type: WarehouseQueryParameter['type'],
	name: string,
): WarehouseQueryParameter['values'] {
	const unique = new Map<string, WarehouseQueryParameterValue>();
	for (const value of values) {
		if (value === null || value === undefined) {
			continue;
		}
		const normalized = normalizeParameterValue(value, type, name);
		unique.set(`${typeof normalized}:${JSON.stringify(normalized)}`, normalized);
	}
	return [...unique.values()];
}

function normalizeParameterValue(
	value: unknown,
	type: WarehouseQueryParameter['type'],
	name: string,
): WarehouseQueryParameterValue {
	if (type === 'STRING' && typeof value === 'string') {
		return value;
	}
	if (
		type === 'INT64' &&
		((typeof value === 'number' && Number.isSafeInteger(value)) ||
			(typeof value === 'string' && /^-?\d+$/.test(value)))
	) {
		return value;
	}
	if (type === 'FLOAT64' && typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (type === 'BOOL' && typeof value === 'boolean') {
		return value;
	}
	if (
		(type === 'NUMERIC' || type === 'BIGNUMERIC') &&
		typeof value === 'string' &&
		/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
	) {
		return value;
	}
	if ((type === 'NUMERIC' || type === 'BIGNUMERIC') && typeof value === 'number') {
		throw new Error(
			`BigQuery array parameter "${name}" received a JavaScript number for ${type}, which may have already lost precision. Cast the source column to VARCHAR in DuckDB or STRING in BigQuery.`,
		);
	}
	if (type === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return value;
	}
	if (
		type === 'DATETIME' &&
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
	) {
		return value;
	}
	if (type === 'TIME' && typeof value === 'string' && /^\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) {
		return value;
	}
	if (type === 'TIMESTAMP' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
		return value;
	}
	if (type === 'INTERVAL' && typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}
	if (type === 'BYTES' && typeof value === 'string' && isBase64(value)) {
		return value;
	}
	if (type === 'GEOGRAPHY' && typeof value === 'string' && value.length > 0) {
		return value;
	}
	if (type === 'JSON' && isJsonParameterValue(value)) {
		if (typeof value === 'string') {
			try {
				JSON.parse(value);
			} catch {
				throw new Error(`BigQuery array parameter "${name}" contains invalid JSON.`);
			}
		}
		return value;
	}
	throw new Error(`BigQuery array parameter "${name}" contains a value incompatible with ${type}.`);
}

function isJsonParameterValue(value: unknown): value is WarehouseQueryParameterValue {
	if (typeof value === 'string' || typeof value === 'boolean') {
		return true;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value);
	}
	if (Array.isArray(value)) {
		return value.every((item) => item === null || isJsonParameterValue(item));
	}
	if (value && typeof value === 'object') {
		return Object.values(value).every((item) => item === null || isJsonParameterValue(item));
	}
	return false;
}

function isBase64(value: string): boolean {
	return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

/** Semantics-only mode: the warehouse is reached through the layer, raw SQL stays for the local database. */
function assertWarehouseSqlAllowed(databaseId: string | undefined, context: ToolContext): void {
	if (context.adminMode || isWarehouseSqlEnabled(context.semanticLayerMode) || databaseId === LOCAL_DATABASE_ID) {
		return;
	}
	throw new Error(
		`Raw SQL on the warehouse is disabled in this project: query metrics with execute_semantic_query. execute_sql only accepts database_id "${LOCAL_DATABASE_ID}", to reshape earlier results (SELECT * FROM <query_id>) or read files.`,
	);
}

const LOCAL_ONLY_DESCRIPTION = [
	`Run DuckDB SQL in nao's local database ("${LOCAL_DATABASE_ID}", the only accepted database_id): the warehouse is only reachable through execute_semantic_query in this project.`,
	'Every earlier query result, including semantic ones, is a table named after its query id, so post-process them here: joins, pivots, shares, deltas. It also reads CSV, JSON, Parquet and Excel files by their path.',
	'To edit a previous local query in-place (keep the same query_id for charts/stories), pass query_id from an earlier execute_sql result.',
].join(' ');

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

const executeSqlTool = createTool<executeSql.Input, executeSql.Output>({
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

export const localOnlyExecuteSql = { ...executeSqlTool, description: LOCAL_ONLY_DESCRIPTION };

export default executeSqlTool;
