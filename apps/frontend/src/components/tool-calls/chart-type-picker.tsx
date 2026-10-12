import {
	ChartArea,
	ChartBarStacked,
	ChartColumn,
	ChartColumnStacked,
	ChartLine,
	ChartNoAxesCombined,
	ChartPie,
	ChartScatter,
	SquareSigma,
} from 'lucide-react';
import type { ChartType } from '@nao/shared/chart-types';
import type { ComponentType } from 'react';
import ChartDonutIcon from '@/components/icons/chart-donut.svg';
import ChartRadarIcon from '@/components/icons/chart-radar.svg';
import ChartStackedAreaIcon from '@/components/icons/chart-stacked-area.svg';

import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ChartTypeOption {
	value: ChartType;
	label: string;
	icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const CHART_TYPE_OPTIONS: ChartTypeOption[] = [
	{ value: 'bar', label: 'Bar', icon: ChartColumn },
	{ value: 'stacked_bar', label: 'Stacked bar', icon: ChartColumnStacked },
	{ value: 'horizontal_bar', label: 'Horizontal bar', icon: ChartBarStacked },
	{ value: 'line', label: 'Line', icon: ChartLine },
	{ value: 'area', label: 'Area', icon: ChartArea },
	{ value: 'stacked_area', label: 'Stacked area', icon: ChartStackedAreaIcon },
	{ value: 'mixed', label: 'Mixed', icon: ChartNoAxesCombined },
	{ value: 'pie', label: 'Pie', icon: ChartPie },
	{ value: 'donut', label: 'Donut', icon: ChartDonutIcon },
	{ value: 'kpi_card', label: 'KPI card', icon: SquareSigma },
	{ value: 'scatter', label: 'Scatter', icon: ChartScatter },
	{ value: 'radar', label: 'Radar', icon: ChartRadarIcon },
];

interface ChartTypePickerProps {
	value: ChartType;
	onValueChange: (value: ChartType) => void;
	className?: string;
}

export function ChartTypePicker({ value, onValueChange, className }: ChartTypePickerProps) {
	return (
		<div
			role='radiogroup'
			aria-label='Chart type'
			className={cn('grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5', className)}
		>
			{CHART_TYPE_OPTIONS.map(({ value: option, label, icon: Icon }) => {
				const isSelected = value === option;
				return (
					<SimpleTooltip key={option} content={label}>
						<button
							type='button'
							role='radio'
							aria-checked={isSelected}
							aria-label={label}
							onClick={() => onValueChange(option)}
							className={cn(
								'flex aspect-square cursor-pointer items-center justify-center rounded-lg border bg-panel text-muted-foreground transition-colors',
								'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								isSelected && 'border-foreground bg-background text-foreground hover:bg-background',
							)}
						>
							<Icon className='size-5' strokeWidth={1.75} />
						</button>
					</SimpleTooltip>
				);
			})}
		</div>
	);
}

export function chartTypeLabel(value: ChartType): string | undefined {
	return CHART_TYPE_OPTIONS.find((option) => option.value === value)?.label;
}
