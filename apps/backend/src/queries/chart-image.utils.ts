import { displayChart } from '@nao/shared/tools';

export function selectLatestDisplayChartTableFormats(
	rows: { toolInput: unknown }[],
): Record<string, displayChart.ColumnConditionalFormats> {
	const formatsByQueryId: Record<string, displayChart.ColumnConditionalFormats> = {};
	for (const row of rows) {
		const parsed = displayChart.InputSchema.safeParse(row.toolInput);
		if (!parsed.success || parsed.data.chart_type !== 'table') {
			continue;
		}
		const { query_id: queryId, conditional_formats: conditionalFormats } = parsed.data;
		if (conditionalFormats && Object.keys(conditionalFormats).length > 0) {
			formatsByQueryId[queryId] = conditionalFormats;
		}
	}
	return formatsByQueryId;
}
