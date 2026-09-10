import type { McpServerStatus } from '@nao/shared';
import {
	type MetabaseCard,
	type MetabaseCardResult,
	MetabaseCardResultSchema,
	MetabaseCardSchema,
	type MetabaseCollection,
	MetabaseCollectionSchema,
	type MetabaseDashboard,
	type MetabaseDashboardCard,
	type MetabaseDashboardParameter,
	MetabaseDashboardSchema,
	type MetabaseDashboardSummary,
	MetabaseDashboardSummarySchema,
	type MetabaseDashboardTab,
	type MetabaseDatasetQuery,
	type MetabaseExecutableQuery,
	MetabaseExecutableQuerySchema,
	type MetabaseParameterMapping,
} from '@nao/shared/metabase-migration';

import { mcpService } from './mcp';
import { isUnauthorizedError, McpAuthRequiredError } from './mcp-oauth';

const METABASE_DISCOVERY_TOOLS = [
	'metabase-list-collections',
	'metabase-list-dashboards',
	'metabase-get-dashboard',
	'metabase-get-question',
] as const;

export type MetabaseMigrationSourceErrorCode =
	| 'configuration'
	| 'authentication'
	| 'ambiguous_server'
	| 'missing_tool'
	| 'source_access'
	| 'unsupported_payload';

export class MetabaseMigrationSourceError extends Error {
	constructor(
		public readonly code: MetabaseMigrationSourceErrorCode,
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = 'MetabaseMigrationSourceError';
	}
}

export interface MetabaseMigrationSourceContext {
	projectId: string;
	userId: string;
}

interface MetabaseMcpClient {
	getServersStatus(projectId: string, userId?: string): Promise<McpServerStatus[]>;
	connectForUser(options: { projectId: string; userId: string; server: string }): Promise<string[]>;
	callTool(options: {
		projectId: string;
		userId: string;
		server: string;
		tool: string;
		args: Record<string, unknown>;
	}): Promise<unknown>;
}

export class MetabaseMigrationSourceService {
	constructor(private readonly client: MetabaseMcpClient = mcpService) {}

	async listCollections(context: MetabaseMigrationSourceContext, serverName?: string): Promise<MetabaseCollection[]> {
		const raw = await this.call(context, serverName, 'metabase-list-collections', {});
		return normalizePayload(() =>
			asList(raw)
				.filter((collection) => asRecord(collection).id !== 'root')
				.map(normalizeCollection),
		);
	}

	async listDashboards(
		context: MetabaseMigrationSourceContext,
		options: { serverName?: string; collectionId?: number } = {},
	): Promise<MetabaseDashboardSummary[]> {
		const raw = await this.call(context, options.serverName, 'metabase-list-dashboards', {});
		const dashboards = normalizePayload(() => asList(raw).map(normalizeDashboardSummary));
		return options.collectionId === undefined
			? dashboards
			: dashboards.filter((dashboard) => dashboard.collectionId === options.collectionId);
	}

	async getDashboard(
		context: MetabaseMigrationSourceContext,
		dashboardId: number,
		serverName?: string,
	): Promise<MetabaseDashboard> {
		const raw = await this.call(context, serverName, 'metabase-get-dashboard', { dashboardId });
		return normalizePayload(() => normalizeDashboard(raw));
	}

	async getCard(context: MetabaseMigrationSourceContext, cardId: number, serverName?: string): Promise<MetabaseCard> {
		const raw = await this.call(context, serverName, 'metabase-get-question', { questionId: cardId });
		return normalizePayload(() => normalizeCard(raw));
	}

	async compileCard(
		context: MetabaseMigrationSourceContext,
		cardId: number,
		options: { serverName?: string; parameters?: Record<string, unknown> } = {},
	): Promise<MetabaseExecutableQuery> {
		const card = await this.getCard(context, cardId, options.serverName);
		if (card.datasetQuery.type === 'native') {
			return normalizePayload(() =>
				MetabaseExecutableQuerySchema.parse({
					sourceType: 'native',
					databaseId: card.databaseId,
					nativeSql: card.datasetQuery.native?.query,
					templateParameters: card.datasetQuery.native?.['template-tags'] ?? {},
					resultMetadata: card.resultMetadata,
				}),
			);
		}

		const raw = await this.call(context, options.serverName, 'metabase-execute-question', {
			questionId: cardId,
			parameters: options.parameters ?? {},
		});
		const compiledSql = extractCompiledSql(raw);
		if (!compiledSql) {
			throw new MetabaseMigrationSourceError(
				'unsupported_payload',
				`Metabase did not return compiled SQL for MBQL card ${cardId}. The configured Metabase MCP server must expose Metabase's native query form.`,
			);
		}
		return normalizePayload(() =>
			MetabaseExecutableQuerySchema.parse({
				sourceType: 'mbql',
				databaseId: card.databaseId,
				compiledSql,
				originalMbql: card.datasetQuery.query,
				templateParameters: {},
				resultMetadata: card.resultMetadata,
			}),
		);
	}

	async executeCard(
		context: MetabaseMigrationSourceContext,
		cardId: number,
		options: { serverName?: string; parameters?: Record<string, unknown> } = {},
	): Promise<MetabaseCardResult> {
		const raw = await this.call(context, options.serverName, 'metabase-execute-question', {
			questionId: cardId,
			parameters: options.parameters ?? {},
		});
		return normalizePayload(() => normalizeCardResult(raw, cardId));
	}

	private async call(
		context: MetabaseMigrationSourceContext,
		serverName: string | undefined,
		tool: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		let server = serverName ?? 'automatically selected server';
		try {
			server = await this.resolveServer(context, serverName, tool);
			const output = await this.client.callTool({
				...context,
				server,
				tool,
				args,
			});
			return parseMcpOutput(output);
		} catch (error) {
			if (error instanceof MetabaseMigrationSourceError) {
				throw error;
			}
			if (error instanceof McpAuthRequiredError || isUnauthorizedError(error)) {
				throw new MetabaseMigrationSourceError(
					'authentication',
					`Metabase authentication failed for MCP server "${server}".`,
					error,
				);
			}
			throw new MetabaseMigrationSourceError(
				'source_access',
				`Metabase MCP tool "${tool}" failed on server "${server}": ${errorMessage(error)}`,
				error,
			);
		}
	}

	private async resolveServer(
		context: MetabaseMigrationSourceContext,
		requestedServer: string | undefined,
		requiredTool: string,
	): Promise<string> {
		const statuses = await this.client.getServersStatus(context.projectId, context.userId);
		if (requestedServer) {
			const requested = statuses.find((status) => status.name === requestedServer);
			if (!requested) {
				throw new MetabaseMigrationSourceError(
					'configuration',
					`MCP server "${requestedServer}" is not configured.`,
				);
			}
			if (!requested.enabled) {
				throw new MetabaseMigrationSourceError(
					'configuration',
					`MCP server "${requestedServer}" is disabled by the project admin.`,
				);
			}
			await this.ensureTool(context, requested, requiredTool);
			return requested.name;
		}

		const compatible = statuses.filter(
			(status) =>
				status.enabled &&
				METABASE_DISCOVERY_TOOLS.every((tool) =>
					status.tools.some((candidate) => candidate.name === tool && candidate.enabled),
				),
		);
		if (compatible.length === 0) {
			throw new MetabaseMigrationSourceError(
				'configuration',
				'No enabled MCP server exposes the required Metabase collection, dashboard, and card tools.',
			);
		}
		if (compatible.length > 1) {
			throw new MetabaseMigrationSourceError(
				'ambiguous_server',
				`Multiple Metabase MCP servers are configured (${compatible.map((status) => status.name).join(', ')}). Select one explicitly.`,
			);
		}
		await this.ensureTool(context, compatible[0], requiredTool);
		return compatible[0].name;
	}

	private async ensureTool(
		context: MetabaseMigrationSourceContext,
		status: McpServerStatus,
		requiredTool: string,
	): Promise<void> {
		if (status.tools.some((tool) => tool.name === requiredTool && tool.enabled)) {
			return;
		}
		const tools = await this.client.connectForUser({
			...context,
			server: status.name,
		});
		if (!tools.includes(requiredTool)) {
			throw new MetabaseMigrationSourceError(
				'missing_tool',
				`Metabase MCP server "${status.name}" does not expose required tool "${requiredTool}".`,
			);
		}
	}
}

function normalizeCollection(value: unknown): MetabaseCollection {
	const raw = asRecord(value);
	return MetabaseCollectionSchema.parse({
		id: requiredNumber(raw.id),
		name: raw.name,
		description: nullableString(raw.description),
		parentId: nullableNumber(raw.parent_id) ?? parentIdFromLocation(raw.location),
		archived: raw.archived ?? false,
	});
}

function normalizeDashboardSummary(value: unknown): MetabaseDashboardSummary {
	const raw = asRecord(value);
	return MetabaseDashboardSummarySchema.parse({
		id: requiredNumber(raw.id),
		name: raw.name,
		description: nullableString(raw.description),
		collectionId: nullableNumber(raw.collection_id),
		archived: raw.archived ?? false,
	});
}

function normalizeDashboard(value: unknown): MetabaseDashboard {
	const raw = asRecord(value);
	const parameters = Array.isArray(raw.parameters) ? raw.parameters.map(normalizeDashboardParameter) : [];
	const tabs = Array.isArray(raw.tabs)
		? raw.tabs
				.map(normalizeDashboardTab)
				.sort((left, right) => left.position - right.position || left.id - right.id)
		: [];
	const tabPositions = new Map(tabs.map((tab, position) => [tab.id, position]));
	const cards = Array.isArray(raw.dashcards)
		? raw.dashcards
				.map((dashcard) => normalizeDashboardCard(dashcard, parameters))
				.sort(
					(left, right) =>
						(tabPositions.get(left.tabId ?? -1) ?? Number.MAX_SAFE_INTEGER) -
							(tabPositions.get(right.tabId ?? -1) ?? Number.MAX_SAFE_INTEGER) ||
						left.row - right.row ||
						left.column - right.column ||
						left.id - right.id,
				)
		: [];
	return MetabaseDashboardSchema.parse({
		id: requiredNumber(raw.id),
		name: raw.name,
		description: nullableString(raw.description),
		collectionId: nullableNumber(raw.collection_id),
		tabs,
		cards,
		parameters,
	});
}

function normalizeDashboardTab(value: unknown): MetabaseDashboardTab {
	const raw = asRecord(value);
	return {
		id: requiredNumber(raw.id),
		name: requiredString(raw.name),
		position: nullableNumber(raw.position) ?? 0,
	};
}

function normalizeDashboardParameter(value: unknown): MetabaseDashboardParameter {
	const raw = asRecord(value);
	return {
		id: requiredString(raw.id),
		name: requiredString(raw.name),
		type: requiredString(raw.type),
		...('default' in raw ? { defaultValue: raw.default } : {}),
		required: raw.required === true,
	};
}

function normalizeDashboardCard(
	value: unknown,
	dashboardParameters: MetabaseDashboardParameter[],
): MetabaseDashboardCard {
	const raw = asRecord(value);
	const cardId = nullableNumber(raw.card_id);
	const card = cardId === null || !isRecord(raw.card) ? null : normalizeCard(raw.card);
	const settings = isRecord(raw.visualization_settings) ? raw.visualization_settings : {};
	const virtualCard = isRecord(settings.virtual_card) ? settings.virtual_card : null;
	const mappings = Array.isArray(raw.parameter_mappings)
		? raw.parameter_mappings.map((mapping) => normalizeParameterMapping(mapping, dashboardParameters, cardId))
		: [];
	return {
		id: requiredNumber(raw.id),
		cardId,
		tabId: nullableNumber(raw.dashboard_tab_id),
		title: card?.name ?? nullableString(virtualCard?.name),
		description: card?.description ?? nullableString(virtualCard?.description),
		row: requiredNumber(raw.row),
		column: requiredNumber(raw.col),
		width: requiredNumber(raw.size_x),
		height: requiredNumber(raw.size_y),
		parameterMappings: mappings,
		visualizationSettings: settings,
		card,
	};
}

function normalizeParameterMapping(
	value: unknown,
	dashboardParameters: MetabaseDashboardParameter[],
	fallbackCardId: number | null,
): MetabaseParameterMapping {
	const raw = asRecord(value);
	const parameterId = requiredString(raw.parameter_id);
	const parameter = dashboardParameters.find((candidate) => candidate.id === parameterId);
	return {
		dashboardParameterId: parameterId,
		targetCardId: requiredNumber(raw.card_id ?? fallbackCardId),
		target: raw.target,
		parameterType: parameter?.type ?? null,
		...(parameter && 'defaultValue' in parameter ? { defaultValue: parameter.defaultValue } : {}),
		required: parameter?.required === true,
	};
}

function normalizeCard(value: unknown): MetabaseCard {
	const raw = asRecord(value);
	const datasetQuery = normalizeDatasetQuery(raw.dataset_query);
	return MetabaseCardSchema.parse({
		id: requiredNumber(raw.id),
		name: raw.name,
		description: nullableString(raw.description),
		databaseId: requiredNumber(raw.database_id ?? datasetQuery.database),
		type: raw.type ?? 'question',
		display: raw.display,
		datasetQuery,
		visualizationSettings: isRecord(raw.visualization_settings) ? raw.visualization_settings : {},
		parameters: Array.isArray(raw.parameters) ? raw.parameters : [],
		resultMetadata: Array.isArray(raw.result_metadata) ? raw.result_metadata : [],
		referencedObjects: extractReferencedObjects(datasetQuery.query),
		hasVisualizationAndResultMetadata: 'visualization_settings' in raw && 'result_metadata' in raw,
	});
}

function normalizeDatasetQuery(value: unknown): MetabaseDatasetQuery {
	const raw = asRecord(value);
	const database = requiredNumber(raw.database);
	if (raw.type === 'native' || raw.type === 'query') {
		return { ...raw, type: raw.type, database } as MetabaseDatasetQuery;
	}
	if (raw['lib/type'] !== 'mbql/query' || !Array.isArray(raw.stages) || raw.stages.length === 0) {
		throw new MetabaseMigrationSourceError('unsupported_payload', 'Metabase returned an unknown query format.');
	}
	const stage = asRecord(raw.stages[0]);
	if (raw.stages.length === 1 && stage['lib/type'] === 'mbql.stage/native' && typeof stage.native === 'string') {
		return {
			type: 'native',
			database,
			native: {
				query: stage.native,
				'template-tags': normalizeTemplateTags(stage['template-tags']),
			},
		};
	}
	return { type: 'query', database, query: raw };
}

function normalizeTemplateTags(value: unknown): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	if (!Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		value.flatMap((tag) => {
			if (!isRecord(tag) || typeof tag.name !== 'string' || !tag.name) {
				return [];
			}
			const dimension = tag.dimension;
			const normalizedDimension =
				Array.isArray(dimension) &&
				dimension[0] === 'field' &&
				isRecord(dimension[1]) &&
				nullableNumber(dimension[2]) !== null
					? ['field', dimension[2], dimension[1]]
					: dimension;
			return [[tag.name, { ...tag, dimension: normalizedDimension }]];
		}),
	);
}

function extractReferencedObjects(value: unknown): Array<{
	type: 'card' | 'metric' | 'segment';
	id: number;
}> {
	const references = new Map<string, { type: 'card' | 'metric' | 'segment'; id: number }>();

	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			const type = candidate[0];
			const id = nullableNumber(candidate[2] ?? candidate[1]);
			if ((type === 'metric' || type === 'segment') && id !== null && id > 0) {
				references.set(`${type}:${id}`, { type, id });
			}
			candidate.forEach(visit);
			return;
		}
		if (!isRecord(candidate)) {
			return;
		}
		const sourceTable = candidate['source-table'];
		const cardId = typeof sourceTable === 'string' ? /^card__(\d+)$/.exec(sourceTable)?.[1] : undefined;
		if (cardId) {
			references.set(`card:${cardId}`, { type: 'card', id: Number(cardId) });
		}
		const sourceCardId = nullableNumber(candidate['source-card']);
		if (sourceCardId !== null && sourceCardId > 0) {
			references.set(`card:${sourceCardId}`, { type: 'card', id: sourceCardId });
		}
		Object.values(candidate).forEach(visit);
	};

	visit(value);
	return [...references.values()];
}

function normalizeCardResult(value: unknown, cardId: number): MetabaseCardResult {
	const raw = asRecord(value);
	const data = isRecord(raw.data) ? raw.data : raw;
	const metadata = Array.isArray(data.cols) ? data.cols : [];
	const rows = Array.isArray(data.rows)
		? data.rows.map((row) => {
				if (!Array.isArray(row)) {
					throw new MetabaseMigrationSourceError(
						'unsupported_payload',
						`Metabase card ${cardId} returned a non-array row.`,
					);
				}
				return row;
			})
		: [];
	return MetabaseCardResultSchema.parse({
		cardId,
		status: raw.status ?? 'completed',
		columns: metadata.map((column) => {
			const rawColumn = asRecord(column);
			return requiredString(rawColumn.name ?? rawColumn.display_name);
		}),
		rows,
		metadata,
	});
}

function extractCompiledSql(value: unknown): string | null {
	const raw = asRecord(value);
	const data = isRecord(raw.data) ? raw.data : raw;
	const nativeForm = isRecord(data.native_form)
		? data.native_form
		: isRecord(data.nativeForm)
			? data.nativeForm
			: null;
	const query = nativeForm?.query ?? nativeForm?.sql;
	return typeof query === 'string' && query.trim() ? query : null;
}

function parseMcpOutput(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.content)) {
		return value;
	}
	if (value.structuredContent !== undefined) {
		return value.structuredContent;
	}
	const text = value.content
		.filter(isRecord)
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n');
	if (!text) {
		throw new MetabaseMigrationSourceError(
			'unsupported_payload',
			'Metabase MCP returned no structured or text content.',
		);
	}
	if (value.isError === true) {
		throw new MetabaseMigrationSourceError('source_access', `Metabase MCP returned an error: ${text}`);
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new MetabaseMigrationSourceError(
			'unsupported_payload',
			'Metabase MCP text output was not valid JSON. Configure the server without Markdown output.',
			error,
		);
	}
}

function asList(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (isRecord(value) && Array.isArray(value.data)) {
		return value.data;
	}
	throw new MetabaseMigrationSourceError(
		'unsupported_payload',
		`Expected a Metabase list payload, received ${describeValue(value)}.`,
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	throw new MetabaseMigrationSourceError(
		'unsupported_payload',
		`Expected a Metabase object payload, received ${describeValue(value)}.`,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredNumber(value: unknown): number {
	const parsed = nullableNumber(value);
	if (parsed !== null) {
		return parsed;
	}
	throw new MetabaseMigrationSourceError(
		'unsupported_payload',
		`Expected a numeric Metabase field, received ${describeValue(value)}.`,
	);
}

function nullableNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && /^-?\d+$/.test(value)) {
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) ? parsed : null;
	}
	return null;
}

function parentIdFromLocation(value: unknown): number | null {
	if (typeof value !== 'string') {
		return null;
	}
	const segments = value.split('/').filter(Boolean);
	const parentId = Number(segments.at(-1));
	return Number.isInteger(parentId) && parentId > 0 ? parentId : null;
}

function requiredString(value: unknown): string {
	if (typeof value === 'string' && value) {
		return value;
	}
	throw new MetabaseMigrationSourceError(
		'unsupported_payload',
		`Expected a non-empty Metabase string, received ${describeValue(value)}.`,
	);
}

function nullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function describeValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return 'an array';
	}
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizePayload<T>(normalize: () => T): T {
	try {
		return normalize();
	} catch (error) {
		if (error instanceof MetabaseMigrationSourceError) {
			throw error;
		}
		throw new MetabaseMigrationSourceError(
			'unsupported_payload',
			`Metabase returned a payload that does not match the migration contract: ${errorMessage(error)}`,
			error,
		);
	}
}

export const metabaseMigrationSourceService = new MetabaseMigrationSourceService();
