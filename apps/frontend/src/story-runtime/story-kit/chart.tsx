import { blockRef } from './block-config';
import { ChartBlock } from './chart-shared';
import type { ChartProps } from './chart-shared';
import type { KIT_CHART_TYPES } from './block-config';

export interface GenericChartProps extends ChartProps {
	type: Exclude<(typeof KIT_CHART_TYPES)[number], 'kpi_card'>;
}

export function Chart(props: GenericChartProps) {
	const { type, ...chart } = props;
	return (
		<ChartBlock
			kind={`${type.replaceAll('_', '-')}-chart`}
			chartType={type}
			blockRef={blockRef('Chart', props)}
			{...chart}
		/>
	);
}
