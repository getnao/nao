import { z } from 'zod/v4';

import { env } from '../../env';
import { createTool } from '../../utils/tools';

const inputSchema = z.object({
	dashboard_id: z.number().int().positive().describe('Numeric Metabase dashboard ID.'),
});

const settingsSchema = z.record(z.string(), z.unknown());

const tabSchema = z.object({
	id: z.number(),
	name: z.string(),
	position: z.number(),
});

const rawCardSchema = z
	.object({
		id: z.number().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		display: z.string().optional(),
		type: z.string().nullable().optional(),
		database_id: z.number().nullable().optional(),
		visualization_settings: settingsSchema.nullable().optional(),
		dataset_query: z.unknown().optional(),
	})
	.passthrough();

const rawDashcardSchema = z
	.object({
		id: z.number(),
		card_id: z.number().nullable().optional(),
		dashboard_tab_id: z.number().nullable().optional(),
		row: z.number().optional(),
		col: z.number().optional(),
		size_x: z.number().optional(),
		size_y: z.number().optional(),
		visualization_settings: settingsSchema.nullable().optional(),
		parameter_mappings: z.array(z.unknown()).optional(),
		card: rawCardSchema.nullable().optional(),
	})
	.passthrough();

const rawDashboardSchema = z
	.object({
		id: z.number(),
		name: z.string(),
		description: z.string().nullable().optional(),
		tabs: z.array(tabSchema.passthrough()).optional(),
		parameters: z.array(z.unknown()).optional(),
		dashcards: z.array(rawDashcardSchema),
	})
	.passthrough();

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
			parameterMappings: z.array(z.unknown()),
			visualizationSettings: settingsSchema,
			question: questionSchema.nullable(),
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
	execute: async ({ dashboard_id }) => {
		if (!env.METABASE_URL || !env.METABASE_API_KEY) {
			throw new Error('Metabase dashboard metadata requires METABASE_URL and METABASE_API_KEY.');
		}

		const url = new URL(`/api/dashboard/${dashboard_id}`, env.METABASE_URL);
		const response = await fetch(url, {
			headers: { 'x-api-key': env.METABASE_API_KEY },
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`Metabase dashboard request failed (${response.status}): ${detail}`);
		}

		return compactDashboard(rawDashboardSchema.parse(await response.json()));
	},
});

function compactDashboard(dashboard: z.infer<typeof rawDashboardSchema>): Output {
	return {
		id: dashboard.id,
		name: dashboard.name,
		description: dashboard.description,
		tabs: (dashboard.tabs ?? [])
			.map(({ id, name, position }) => ({ id, name, position }))
			.sort((left, right) => left.position - right.position),
		filters: dashboard.parameters ?? [],
		cards: dashboard.dashcards.map((placement) => ({
			placementId: placement.id,
			questionId: placement.card_id ?? null,
			tabId: placement.dashboard_tab_id ?? null,
			row: placement.row ?? 0,
			column: placement.col ?? 0,
			width: placement.size_x ?? 1,
			height: placement.size_y ?? 1,
			parameterMappings: placement.parameter_mappings ?? [],
			visualizationSettings: placement.visualization_settings ?? {},
			question: compactQuestion(placement.card),
		})),
	};
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
