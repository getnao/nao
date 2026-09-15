import { z } from 'zod/v4';

import { env } from '../../env';
import { mcpService } from '../../services/mcp';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';

const METABASE_SERVER = 'metabase';
const READ_RESOURCE_TOOL = 'read_resource';
const MAX_RESOURCE_URIS = 5;

const inputSchema = z.object({
	dashboard_id: z.number().int().positive().describe('Numeric Metabase dashboard ID.'),
});

const settingsSchema = z.record(z.string(), z.unknown());

const parameterMappingSchema = z.looseObject({
	parameter_id: z.string(),
	card_id: z.number().nullable().optional(),
	target: z.unknown().optional(),
});

const tabSchema = z.looseObject({
	id: z.number(),
	name: z.string(),
	position: z.number(),
});

const rawCardSchema = z.looseObject({
	id: z.number().optional(),
	name: z.string().optional(),
	description: z.string().nullable().optional(),
	display: z.string().optional(),
	type: z.string().nullable().optional(),
	database_id: z.number().nullable().optional(),
	visualization_settings: settingsSchema.nullable().optional(),
	dataset_query: z.unknown().optional(),
});

const rawDashcardSchema = z.looseObject({
	id: z.number(),
	card_id: z.number().nullable().optional(),
	dashboard_tab_id: z.number().nullable().optional(),
	row: z.number().optional(),
	col: z.number().optional(),
	size_x: z.number().optional(),
	size_y: z.number().optional(),
	visualization_settings: settingsSchema.nullable().optional(),
	parameter_mappings: z.array(parameterMappingSchema).optional(),
	card: rawCardSchema.nullable().optional(),
	series: z.array(rawCardSchema).optional(),
});

const rawDashboardSchema = z.looseObject({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable().optional(),
	tabs: z.array(tabSchema).optional(),
	parameters: z.array(z.unknown()).optional(),
	dashcards: z.array(rawDashcardSchema),
});

const questionSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable().optional(),
	display: z.string(),
	type: z.string().nullable().optional(),
	databaseId: z.number().nullable().optional(),
	queryType: z.string().optional(),
	nativeSql: z.string().optional(),
	templateTags: settingsSchema.optional(),
	sourceTable: z.union([z.string(), z.number()]).optional(),
	visualizationSettings: settingsSchema,
});

const outputSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable().optional(),
	tabs: z.array(tabSchema),
	filters: z.array(z.unknown()),
	cards: z.array(
		z.object({
			placementId: z.number(),
			questionId: z.number().nullable(),
			tabId: z.number().nullable(),
			row: z.number(),
			column: z.number(),
			width: z.number(),
			height: z.number(),
			parameterMappings: z.array(
				z.object({
					parameterId: z.string(),
					questionId: z.number().nullable(),
					target: z.unknown().optional(),
				}),
			),
			effectiveFilterIds: z.array(z.string()),
			visualizationSettings: settingsSchema,
			question: questionSchema.nullable(),
			series: z.array(
				z.object({
					questionId: z.number(),
					parameterMappings: z.array(
						z.object({
							parameterId: z.string(),
							questionId: z.number().nullable(),
							target: z.unknown().optional(),
						}),
					),
					effectiveFilterIds: z.array(z.string()),
					question: questionSchema.nullable(),
				}),
			),
		}),
	),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export default createTool<Input, Output>({
	description:
		'Read one Metabase dashboard through its REST API to preserve card visualization settings, tabs, filters, and layout. Use only for a Metabase-to-story import after resolving a numeric dashboard ID through the official MCP. This tool is read-only.',
	inputSchema,
	outputSchema,
	execute: async ({ dashboard_id }, context) => {
		if (!env.METABASE_URL || !env.METABASE_API_KEY) {
			throw new Error('Metabase dashboard metadata requires METABASE_URL and METABASE_API_KEY.');
		}

		const dashboardUri = `metabase://dashboard/${dashboard_id}`;
		const authorizedDashboardUris = await authorizedMetabaseResources(context, [dashboardUri]);
		if (!authorizedDashboardUris.has(dashboardUri)) {
			throw new Error('Metabase denied access to the requested dashboard.');
		}

		const response = await fetch(metabaseApiUrl(`api/dashboard/${dashboard_id}`), {
			headers: { 'x-api-key': env.METABASE_API_KEY },
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`Metabase dashboard request failed (${response.status}): ${detail}`);
		}

		const dashboard = rawDashboardSchema.parse(await response.json());
		const questionUris = [
			...new Set(
				dashboard.dashcards
					.flatMap((placement) => [
						placement.card_id,
						placement.card?.id,
						...(placement.series ?? []).map((card) => card.id),
					])
					.filter((id): id is number => id !== null && id !== undefined)
					.map((id) => `metabase://question/${id}`),
			),
		];
		const authorizedQuestionUris = await authorizedMetabaseResources(context, questionUris);
		return compactDashboard(dashboard, authorizedQuestionUris);
	},
});

async function authorizedMetabaseResources(context: ToolContext, uris: string[]): Promise<Set<string>> {
	if (uris.length === 0) {
		return new Set();
	}
	const serverUrl = await mcpService.getServerUrl(context.projectId, METABASE_SERVER);
	if (!serverUrl || normalizedUrl(serverUrl) !== normalizedUrl(metabaseApiUrl('api/metabase-mcp'))) {
		throw new Error('The metabase MCP server must use the configured METABASE_URL.');
	}

	const authorized = new Set<string>();
	for (let offset = 0; offset < uris.length; offset += MAX_RESOURCE_URIS) {
		const batch = uris.slice(offset, offset + MAX_RESOURCE_URIS);
		const result = await mcpService.callTool({
			projectId: context.projectId,
			userId: context.userId,
			server: METABASE_SERVER,
			tool: READ_RESOURCE_TOOL,
			args: { uris: batch },
			allowedServers: [METABASE_SERVER],
			requireUserOAuth: true,
		});
		for (const uri of authorizedResourceUris(result, batch)) {
			authorized.add(uri);
		}
	}
	return authorized;
}

function metabaseApiUrl(path: string): URL {
	return new URL(path, `${env.METABASE_URL!.replace(/\/+$/, '')}/`);
}

function normalizedUrl(value: string | URL): string {
	const url = new URL(value);
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.toString();
}

function authorizedResourceUris(result: unknown, uris: string[]): string[] {
	const resultRecord = asRecord(result);
	if (resultRecord.isError === true) {
		return [];
	}
	const resources = asRecord(resultRecord.structuredContent).resources;
	if (!Array.isArray(resources) || resources.length !== uris.length) {
		return [];
	}
	return uris.filter((_uri, index) => {
		const resource = asRecord(resources[index]);
		return !Object.hasOwn(resource, 'error') && Object.hasOwn(resource, 'content');
	});
}

function compactDashboard(dashboard: z.infer<typeof rawDashboardSchema>, authorizedQuestionUris: Set<string>): Output {
	return {
		id: dashboard.id,
		name: dashboard.name,
		description: dashboard.description,
		tabs: (dashboard.tabs ?? [])
			.map(({ id, name, position }) => ({ id, name, position }))
			.sort((left, right) => left.position - right.position),
		filters: dashboard.parameters ?? [],
		cards: dashboard.dashcards.map((placement) => {
			const questionId = placement.card_id ?? null;
			const parameterMappings = compactParameterMappings(placement, questionId);
			return {
				placementId: placement.id,
				questionId,
				tabId: placement.dashboard_tab_id ?? null,
				row: placement.row ?? 0,
				column: placement.col ?? 0,
				width: placement.size_x ?? 1,
				height: placement.size_y ?? 1,
				parameterMappings,
				effectiveFilterIds: effectiveFilterIds(parameterMappings),
				visualizationSettings: placement.visualization_settings ?? {},
				question: authorizedQuestionUris.has(`metabase://question/${placement.card?.id}`)
					? compactQuestion(placement.card)
					: null,
				series: (placement.series ?? []).flatMap((card) => {
					if (card.id === undefined) {
						return [];
					}
					const mappings = compactParameterMappings(placement, card.id);
					return [
						{
							questionId: card.id,
							parameterMappings: mappings,
							effectiveFilterIds: effectiveFilterIds(mappings),
							question: authorizedQuestionUris.has(`metabase://question/${card.id}`)
								? compactQuestion(card)
								: null,
						},
					];
				}),
			};
		}),
	};
}

function compactParameterMappings(
	placement: z.infer<typeof rawDashcardSchema>,
	questionId: number | null,
): Output['cards'][number]['parameterMappings'] {
	return (placement.parameter_mappings ?? [])
		.filter((mapping) => (mapping.card_id ?? null) === questionId)
		.map((mapping) => ({
			parameterId: mapping.parameter_id,
			questionId: mapping.card_id ?? null,
			target: mapping.target,
		}));
}

function effectiveFilterIds(
	mappings: Output['cards'][number]['parameterMappings'],
): Output['cards'][number]['effectiveFilterIds'] {
	return [...new Set(mappings.map((mapping) => mapping.parameterId))];
}

function compactQuestion(card: z.infer<typeof rawCardSchema> | null | undefined): Output['cards'][number]['question'] {
	if (!card || card.id === undefined || card.name === undefined || card.display === undefined) {
		return null;
	}
	const datasetQuery = asRecord(card.dataset_query);
	const native = asRecord(datasetQuery.native);
	const query = asRecord(datasetQuery.query);
	const stages = Array.isArray(datasetQuery.stages) ? datasetQuery.stages.map(asRecord) : [];
	const nativeStage = stages.find((stage) => typeof stage.native === 'string');
	const nativeSql =
		typeof native.query === 'string'
			? native.query
			: typeof nativeStage?.native === 'string'
				? nativeStage.native
				: undefined;
	const templateTags = normalizeTemplateTags(native['template-tags'] ?? nativeStage?.['template-tags']);
	const sourceTable =
		query['source-table'] ?? stages.find((stage) => stage['source-table'] !== undefined)?.['source-table'];
	const queryType = [datasetQuery.type, nativeStage?.['lib/type'], datasetQuery['lib/type']].find(
		(value): value is string => typeof value === 'string',
	);

	return {
		id: card.id,
		name: card.name,
		description: card.description,
		display: card.display,
		type: card.type,
		databaseId: card.database_id,
		queryType,
		nativeSql,
		...(Object.keys(templateTags).length > 0 && { templateTags }),
		...((typeof sourceTable === 'string' || typeof sourceTable === 'number') && { sourceTable }),
		visualizationSettings: card.visualization_settings ?? {},
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeTemplateTags(value: unknown): Record<string, unknown> {
	if (!Array.isArray(value)) {
		return asRecord(value);
	}

	return Object.fromEntries(
		value
			.map(asRecord)
			.filter((tag): tag is Record<string, unknown> & { name: string } => typeof tag.name === 'string')
			.map((tag) => [tag.name, tag]),
	);
}
