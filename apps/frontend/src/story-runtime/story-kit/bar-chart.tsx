import { barChartType, blockRef } from './block-config';
import { ChartBlock } from './chart-shared';
import type { ChartProps } from './chart-shared';

export interface BarChartProps extends ChartProps {
	stacked?: boolean;
	horizontal?: boolean;
	percent?: boolean;
}

export function BarChart(props: BarChartProps) {
	const { stacked = false, horizontal = false, percent = false, ...chart } = props;
	return (
		<ChartBlock
			kind='bar-chart'
			chartType={barChartType(stacked, horizontal, percent)}
			blockRef={blockRef('BarChart', props)}
			{...chart}
		/>
	);
}
