import { lineChartType, blockRef } from './block-config';
import { ChartBlock } from './chart-shared';
import type { ChartProps } from './chart-shared';

export interface LineChartProps extends ChartProps {
	area?: boolean;
	stacked?: boolean;
	percent?: boolean;
}

export function LineChart(props: LineChartProps) {
	const { area = false, stacked = false, percent = false, ...chart } = props;
	return (
		<ChartBlock
			kind='line-chart'
			chartType={lineChartType(area, stacked, percent)}
			blockRef={blockRef('LineChart', props)}
			{...chart}
		/>
	);
}
