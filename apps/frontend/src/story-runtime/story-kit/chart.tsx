import { blockRef } from './block-config';
import { ChartBlock } from './chart-shared';
import type { ChartProps } from './chart-shared';
import type { ChartType } from '@nao/shared/chart-types';

export interface GenericChartProps extends ChartProps {
	type: Exclude<ChartType, 'kpi_card'>;
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
