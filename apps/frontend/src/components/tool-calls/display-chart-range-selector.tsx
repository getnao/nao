import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { RangeOptions } from '@/lib/charts.utils';

interface Props<T extends RangeOptions> {
	selectedRange: keyof T;
	options: T;
	onRangeSelected: (range: keyof T) => void;
}

export function ChartRangeSelector<T extends RangeOptions>({ options, selectedRange, onRangeSelected }: Props<T>) {
	return (
		<Select value={selectedRange as string} onValueChange={(v) => onRangeSelected(v as keyof T)}>
			<SelectTrigger className='border-none dark:bg-transparent dark:hover:bg-transparent'>
				<SelectValue>{options[selectedRange].label}</SelectValue>
			</SelectTrigger>

			<SelectContent align='center' position='item-aligned' className='border-none dark:bg-background'>
				{Object.entries(options).map(([key, value]) => (
					<SelectItem key={key} value={key}>
						{value.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
