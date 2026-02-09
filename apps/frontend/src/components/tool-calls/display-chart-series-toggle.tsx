import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { labelize } from '@/lib/charts.utils';

interface DisplayChartSeriesToggleProps {
	series: { data_key: string }[];
	visibleSeries: Record<string, boolean>;
	onToggle: (dataKey: string) => void;
}

export function DisplayChartSeriesToggle({ series, visibleSeries, onToggle }: DisplayChartSeriesToggleProps) {
	const visibleCount = Object.values(visibleSeries).filter(Boolean).length;
	const totalCount = series.length;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className='h-7 text-xs gap-1'>
					Series ({visibleCount}/{totalCount})
					<ChevronDown className='size-3' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start'>
				{series.map((s) => (
					<DropdownMenuCheckboxItem
						key={s.data_key}
						checked={visibleSeries[s.data_key] ?? true}
						onCheckedChange={() => onToggle(s.data_key)}
					>
						{labelize(s.data_key)}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
