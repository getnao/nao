import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import { displayTable } from '@nao/shared/tools';

/**
 * Reduces `display_table` tool inputs (ordered oldest → newest) to a
 * query_id → conditional-formatting map, with the latest entry per query_id
 * winning. Kept db-free so the deterministic selection is unit-testable.
 */
export function selectLatestDisplayTableFormats(
	rows: { toolInput: unknown }[],
): Record<string, ColumnConditionalFormats> {
	const formatsByQueryId: Record<string, ColumnConditionalFormats> = {};
	for (const row of rows) {
		const parsed = displayTable.InputSchema.safeParse(row.toolInput);
		if (!parsed.success) {
			continue;
		}
		const { query_id: queryId, conditional_formats: conditionalFormats } = parsed.data;
		if (conditionalFormats && Object.keys(conditionalFormats).length > 0) {
			formatsByQueryId[queryId] = conditionalFormats;
		}
	}
	return formatsByQueryId;
}
