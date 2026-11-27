import { SEMANTIC_LAYER_MODES } from '@nao/shared/types';
import type { SemanticLayerMode } from '@nao/shared/types';

export const SEMANTIC_LAYER_MODE_DETAILS: Record<SemanticLayerMode, { label: string; description: string }> = {
	prioritized: {
		label: 'Semantics first',
		description:
			'Metric questions go through the semantic layer first; the agent falls back to SQL when it cannot answer.',
	},
	exclusive: {
		label: 'Semantics only',
		description:
			"Every warehouse question goes through the semantic layer; SQL is limited to nao's local DuckDB to reshape results and read files.",
	},
	disabled: {
		label: "Don't use semantics",
		description: 'Definitions stay readable as context, but the agent cannot run semantic queries.',
	},
};

export const SEMANTIC_LAYER_MODE_CAPABILITIES: Record<
	SemanticLayerMode,
	{ semanticQueries: boolean; warehouseSql: boolean }
> = {
	prioritized: { semanticQueries: true, warehouseSql: true },
	exclusive: { semanticQueries: true, warehouseSql: false },
	disabled: { semanticQueries: false, warehouseSql: true },
};

export function isSemanticLayerMode(value: string): value is SemanticLayerMode {
	return (SEMANTIC_LAYER_MODES as readonly string[]).includes(value);
}
