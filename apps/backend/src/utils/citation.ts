import type { ColumnLineageNode } from '@nao/shared';
import type { LineageNode } from '@polyglot-sql/sdk';
import { generate, init } from '@polyglot-sql/sdk';

let polyglotInitialized = false;

export async function ensurePolyglotInitialized() {
	if (!polyglotInitialized) {
		await init();
		polyglotInitialized = true;
	}
}

export function extractLineageNode(raw: LineageNode): ColumnLineageNode {
	return {
		name: raw.name,
		source_name: raw.source_name,
		expression: expressionToString(raw.expression),
		reference_node_name: raw.reference_node_name || undefined,
		sources: (raw.downstream ?? []).map((d) => extractLineageNode(d)),
	};
}

function expressionToString(expr: unknown): string | undefined {
	if (!expr) {
		return undefined;
	}
	const result = generate(expr);
	return result.success && result.sql?.length ? result.sql[0] : undefined;
}
