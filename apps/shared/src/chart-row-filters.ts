export type ChartStateDimensionFilters = {
	filterStateTypes?: string[] | undefined;
	filterStateNames?: string[] | undefined;
};

function readStateColumn(row: Record<string, unknown>, logicalKey: string): string {
	for (const [key, raw] of Object.entries(row)) {
		if (key.toLowerCase() === logicalKey) {
			if (raw === null || raw === undefined) {
				return '';
			}
			return typeof raw === 'string' ? raw : String(raw);
		}
	}
	return '';
}

export function filterChartRowsByStateDimensions(
	data: Record<string, unknown>[],
	filters: ChartStateDimensionFilters,
): Record<string, unknown>[] {
	let rows = data;
	const types = filters.filterStateTypes?.filter((t) => t.length > 0);
	const names = filters.filterStateNames?.filter((n) => n.length > 0);

	if (types?.length) {
		const allowed = new Set(types);
		rows = rows.filter((row) => allowed.has(readStateColumn(row, 'state_type')));
	}
	if (names?.length) {
		const allowed = new Set(names);
		rows = rows.filter((row) => allowed.has(readStateColumn(row, 'state_name')));
	}
	return rows;
}
