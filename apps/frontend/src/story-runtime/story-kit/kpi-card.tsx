import { computeKpiComparison, KpiCard as ChartKpiCard } from '@nao/shared/chart-builder';
import { Block, BlockState } from './block';
import { blockRef, kpiBlockConfig, resolveXKey } from './block-config';
import { isNumericColumn, withNumericValues } from './columns';
import { toChartValueFormat } from './format';
import { useBlockData } from './use-block-data';
import type { displayChart } from '@nao/shared/tools';
import type { BlockProps } from './block';
import type { FormatOptions } from './format';
import type { BlockDataSource, Row } from './use-block-data';

export interface KpiCardProps extends BlockProps, BlockDataSource, FormatOptions {
	valueKey?: string;
	xKey?: string;
	comparison?: displayChart.ComparisonMode;
	label?: string;
	valueFormat?: displayChart.ValueFormat;
}

export function KpiCard(props: KpiCardProps) {
	const { queryId, data, valueKey, xKey, comparison, label, valueFormat, format, currency, decimals, ...block } =
		props;
	const source = useBlockData({ queryId, data });
	const resolvedFormat = valueFormat ?? toChartValueFormat({ format, currency, decimals });
	const resolved =
		source.status === 'ready'
			? {
					valueKey: resolveValueKey(source.rows, source.columns, valueKey),
					xAxisKey: resolveXKey(source.rows, source.columns, xKey),
				}
			: null;
	const edit =
		resolved && source.status === 'ready'
			? {
					block: blockRef('KpiCard', props),
					config: kpiBlockConfig(
						queryId,
						block.title,
						{ key: resolved.valueKey, label, valueFormat: resolvedFormat },
						resolved.xAxisKey,
						comparison,
					),
					columns: source.columns,
					rows: source.rows,
				}
			: undefined;

	return (
		<Block kind='kpi' edit={edit} {...block}>
			<BlockState data={source}>
				{(rows) => {
					if (!resolved) {
						return null;
					}
					const numericRows = withNumericValues(rows, [resolved.valueKey]);
					return (
						<ChartKpiCard
							value={numericRows[numericRows.length - 1]?.[resolved.valueKey]}
							displayName={label}
							comparison={computeKpiComparison(
								numericRows,
								resolved.xAxisKey,
								resolved.valueKey,
								comparison,
							)}
							valueFormat={resolvedFormat}
						/>
					);
				}}
			</BlockState>
		</Block>
	);
}

function resolveValueKey(rows: Row[], columns: string[], valueKey?: string): string {
	return valueKey ?? columns.find((column) => isNumericColumn(rows, column)) ?? columns[0];
}
