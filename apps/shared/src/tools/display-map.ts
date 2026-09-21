import z from 'zod/v3';

import type { CustomBoundarySet } from '../map';

export const MapTypeEnum = z.enum(['points', 'scatter_bubble', 'choropleth']);

export const RegionBoundariesEnum = z.enum(['world_countries', 'france_regions']);

/** Flat schema shared by every map type — all type-specific columns are optional here and made required per map_type in {@link buildInputSchema}. Exported as a plain `ZodObject` so MCP clients get a serializable input schema (a `ZodEffects`/`ZodIntersection` would advertise zero parameters). */
export function buildInputObjectSchema(customSets?: CustomBoundarySet[]) {
	const builtinKeys = RegionBoundariesEnum.options;
	const customKeys = customSets?.map((s) => s.key) ?? [];
	const allKeys = [...builtinKeys, ...customKeys] as [string, ...string[]];

	const customGuidance =
		customSets && customSets.length > 0
			? ' ' + customSets.map((s) => `For "${s.key}" (${s.label}): ${s.regionKeyHint}.`).join(' ')
			: '';

	const regionBoundariesDescription =
		`Built-in boundary set for a "choropleth", joined via region_key. Available sets: ${allKeys.join(', ')}.` +
		` Omit when providing boundaries_url or geometry_key instead.`;

	const regionKeyDescription =
		`Column identifying each region for a "choropleth". For "world_countries" match an ISO 3166-1 alpha-3/alpha-2 code or country name; for "france_regions" match the region code or name.` +
		customGuidance;

	return z.object({
		query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
		map_type: MapTypeEnum.describe(
			'Type of map: "points" (markers), "scatter_bubble" (markers sized by a numeric column), or "choropleth" (regions shaded by a numeric column).',
		),
		latitude_key: z
			.string()
			.optional()
			.describe('Column with the latitude in WGS84 decimal degrees. Required for "points" and "scatter_bubble".'),
		longitude_key: z
			.string()
			.optional()
			.describe(
				'Column with the longitude in WGS84 decimal degrees. Required for "points" and "scatter_bubble".',
			),
		label_key: z
			.string()
			.optional()
			.describe('Column name used as the title of the popup shown when a point or region is clicked.'),
		tooltip_keys: z
			.array(z.string())
			.optional()
			.describe('Additional column names to display as label/value rows in the popup.'),
		color: z
			.string()
			.optional()
			.describe(
				'CSS color for point/bubble markers, and the base color of the choropleth color scale. Defaults to the theme primary color when unset.',
			),
		radius: z
			.number()
			.min(1)
			.max(30)
			.optional()
			.describe(
				'Radius in pixels of the markers ("points"), or the largest bubble ("scatter_bubble"). Ignored by "choropleth". Defaults to 5.',
			),
		size_key: z
			.string()
			.optional()
			.describe('Numeric column that scales the bubble radius. Required for "scatter_bubble".'),
		value_key: z
			.string()
			.optional()
			.describe('Numeric column mapped to the choropleth color scale. Required for "choropleth".'),
		region_key: z.string().optional().describe(regionKeyDescription),
		region_boundaries: z.enum(allKeys).optional().describe(regionBoundariesDescription),
		boundaries_url: z
			.string()
			.optional()
			.describe(
				'HTTPS URL to a public GeoJSON FeatureCollection of boundary polygons for a "choropleth". Prefer this over geometry_key whenever a public URL exists (countries, US states, regions, etc.) — it avoids pulling large geometry through SQL. Pair with region_key to join data rows to features, and optionally boundaries_join_property to specify which feature property to match on.',
			),
		boundaries_join_property: z
			.string()
			.optional()
			.describe(
				'Feature property name in the boundaries_url GeoJSON to match against region_key values. Optional — when omitted the join is attempted against all feature properties automatically.',
			),
		geometry_key: z
			.string()
			.optional()
			.describe(
				'Column containing a GeoJSON geometry (string or object) per row for a custom "choropleth" (e.g. ST_AsGeoJSON in PostGIS). Use only when the geometry lives in the warehouse and no public URL exists — prefer boundaries_url instead. Never fabricate or approximate shapes (e.g. bounding boxes). When no real geometry exists for the requested zones, use a "points"/"scatter_bubble" map at each area centroid instead.',
			),
		title: z
			.string()
			.describe(
				'A concise and descriptive title of what the map shows. Do not include the type of map in the title or other map configurations.',
			),
	});
}

const CHOROPLETH_BOUNDARY_MESSAGE = {
	message:
		'A choropleth needs one of: geometry_key, boundaries_url with region_key, or both region_boundaries and region_key.',
};

const choroplethHasBoundary = (
	input: Pick<Input, 'geometry_key' | 'boundaries_url' | 'region_boundaries' | 'region_key'>,
) =>
	!!input.geometry_key ||
	(!!input.boundaries_url && !!input.region_key) ||
	(!!input.region_boundaries && !!input.region_key);

export function buildInputSchema(customSets?: CustomBoundarySet[]) {
	const base = buildInputObjectSchema(customSets);
	const pointsSchema = base.required({ latitude_key: true, longitude_key: true });
	const scatterBubbleSchema = base.required({ latitude_key: true, longitude_key: true, size_key: true });
	const choroplethSchema = base
		.required({ value_key: true })
		.refine(choroplethHasBoundary, CHOROPLETH_BOUNDARY_MESSAGE);

	return base.superRefine((input, context) => {
		const schema =
			input.map_type === 'choropleth'
				? choroplethSchema
				: input.map_type === 'scatter_bubble'
					? scatterBubbleSchema
					: pointsSchema;
		const result = schema.safeParse(input);
		if (result.success) {
			return;
		}
		for (const issue of result.error.issues) {
			context.addIssue(issue);
		}
	}) as z.ZodType<Input>;
}

export const InputSchema = buildInputSchema();

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
	warning: z.string().optional(),
	point_count: z.number().optional(),
	region_count: z.number().optional(),
	dropped_row_count: z.number().optional(),
});

export type MapType = z.infer<typeof MapTypeEnum>;
export type RegionBoundaries = string;
type BaseInput = z.infer<ReturnType<typeof buildInputObjectSchema>>;
export type Input = Omit<BaseInput, 'region_boundaries'> & { region_boundaries?: string };
export type Output = z.infer<typeof OutputSchema>;
