import type { ParsedParameterBlock } from '@nao/shared/story-segments';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MAX_TOGGLE_OPTIONS = 3;

export function StoryParameterControl({
	parameter,
	value,
	onChange,
}: {
	parameter: ParsedParameterBlock;
	value: string | undefined;
	onChange: (value: string) => void;
}) {
	const selectedValue = parameter.options.some((option) => option.value === value) ? value! : parameter.defaultValue;

	return (
		<div className='nao-filter flex flex-col gap-1'>
			<span className='nao-label text-xs font-medium text-muted-foreground'>{parameter.label}</span>
			{parameter.options.length <= MAX_TOGGLE_OPTIONS ? (
				<ParameterToggle parameter={parameter} value={selectedValue} onChange={onChange} />
			) : (
				<Select value={selectedValue} onValueChange={onChange}>
					<SelectTrigger className='nao-filter__control h-8 min-w-36 bg-background'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{parameter.options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}

function ParameterToggle({
	parameter,
	value,
	onChange,
}: {
	parameter: ParsedParameterBlock;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div
			role='radiogroup'
			aria-label={parameter.label}
			className='nao-filter__control inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5'
		>
			{parameter.options.map((option) => {
				const isSelected = option.value === value;
				return (
					<button
						key={option.value}
						type='button'
						role='radio'
						aria-checked={isSelected}
						onClick={() => onChange(option.value)}
						className={cn(
							'h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
							isSelected && 'bg-background text-foreground shadow-xs',
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
