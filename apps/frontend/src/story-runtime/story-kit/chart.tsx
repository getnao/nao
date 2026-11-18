import { isBuiltinChartType } from '@nao/shared/chart-types';
import { blockRef } from './block-config';
import { ChartBlock } from './chart-shared';
import { PluginChartBlock } from './plugin-chart';
import type { ChartProps } from './chart-shared';
import type { ChartType } from '@nao/shared/chart-types';

export interface GenericChartProps extends ChartProps {
	type: Exclude<ChartType, 'kpi_card'> | (string & {});
}

export function Chart(props: GenericChartProps) {
	const { type, ...chart } = props;
	const kind = `${type.replaceAll('_', '-')}-chart`;
	if (!isBuiltinChartType(type)) {
		return <PluginChartBlock kind={kind} chartType={type} {...chart} />;
	}
	return <ChartBlock kind={kind} chartType={type} blockRef={blockRef('Chart', props)} {...chart} />;
}
