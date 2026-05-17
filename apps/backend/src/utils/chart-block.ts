import type { displayChart } from '@nao/shared/tools';

function escapeDoubleQuotedAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeSingleQuotedAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function formatChartBlock(config: displayChart.Input): string {
	const seriesJson = JSON.stringify(config.series);
	return (
		`<chart query_id="${escapeDoubleQuotedAttr(config.query_id)}" ` +
		`chart_type="${escapeDoubleQuotedAttr(config.chart_type)}" ` +
		`x_axis_key="${escapeDoubleQuotedAttr(config.x_axis_key)}" ` +
		`x_axis_type="${escapeDoubleQuotedAttr(config.x_axis_type ?? '')}" ` +
		`series='${escapeSingleQuotedAttr(seriesJson)}' ` +
		`title="${escapeDoubleQuotedAttr(config.title ?? '')}" />`
	);
}
