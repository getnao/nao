import { FilterX, X } from 'lucide-react';
import type { DbtChartsControl, DbtChartsVariables } from '@nao/shared/dbt-charts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CLEAR_VALUE = '__nao_dbt_charts_clear__';
const VALUE_PREFIX = '__nao_dbt_charts_value__:';

interface DbtChartsControlsProps {
	controls: DbtChartsControl[];
	overrides: DbtChartsVariables;
	onChange: (name: string, value: unknown) => void;
	onReset: () => void;
	disabled?: boolean;
}

export function DbtChartsControls({ controls, overrides, onChange, onReset, disabled }: DbtChartsControlsProps) {
	if (controls.length === 0) {
		return null;
	}
	const hasOverrides = Object.keys(overrides).length > 0;

	return (
		<div className='flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3'>
			{controls.map((control) => (
				<div key={control.name} className='flex min-w-36 flex-col gap-1'>
					<div className='flex items-center justify-between gap-1'>
						<span className='text-xs font-medium text-muted-foreground'>{control.label}</span>
						{control.can_unset && control.name in overrides && (
							<button
								type='button'
								className='rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
								aria-label={`Reset ${control.label}`}
								onClick={() => onChange(control.name, undefined)}
							>
								<X className='size-3' />
							</button>
						)}
					</div>
					<ControlInput
						control={control}
						disabled={disabled || !control.enabled}
						onChange={(value) => onChange(control.name, value)}
					/>
				</div>
			))}
			{hasOverrides && (
				<Button variant='ghost' size='sm' className='h-8 gap-1.5' onClick={onReset} disabled={disabled}>
					<FilterX className='size-3.5' />
					Reset
				</Button>
			)}
		</div>
	);
}

function ControlInput({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	switch (control.input) {
		case 'select':
		case 'radio':
			return <SingleSelect control={control} disabled={disabled} onChange={onChange} />;
		case 'multiselect':
			return <MultiSelect control={control} disabled={disabled} onChange={onChange} />;
		case 'checkbox':
			return (
				<div className='flex h-8 items-center'>
					<Checkbox
						checked={Boolean(control.value)}
						disabled={disabled}
						onCheckedChange={(checked) => onChange(checked === true)}
					/>
				</div>
			);
		case 'slider':
			return <SliderInput control={control} disabled={disabled} onChange={onChange} />;
		case 'range':
			return <RangeInput control={control} disabled={disabled} onChange={onChange} />;
		case 'number':
			return (
				<Input
					type='number'
					className='h-8 min-w-36 bg-background'
					value={stringValue(control.value)}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
				/>
			);
		case 'date':
		case 'datepicker':
			return (
				<Input
					type='date'
					className='h-8 min-w-40 bg-background'
					value={stringValue(control.value)}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value || undefined)}
				/>
			);
		case 'daterange':
			return <DateRangeInput control={control} disabled={disabled} onChange={onChange} />;
		default:
			return (
				<Input
					type='text'
					className='h-8 min-w-44 bg-background'
					value={stringValue(control.value)}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
	}
}

function SingleSelect({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	const current = stringValue(control.value);
	return (
		<Select
			disabled={disabled}
			value={current ? `${VALUE_PREFIX}${current}` : CLEAR_VALUE}
			onValueChange={(value) => onChange(value === CLEAR_VALUE ? null : value.slice(VALUE_PREFIX.length))}
		>
			<SelectTrigger className='h-8 min-w-36 bg-background'>
				<SelectValue placeholder='All' />
			</SelectTrigger>
			<SelectContent>
				{control.can_unset && <SelectItem value={CLEAR_VALUE}>All</SelectItem>}
				{control.options.map((option) => (
					<SelectItem key={option} value={`${VALUE_PREFIX}${option}`}>
						{option}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function MultiSelect({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	const selected = Array.isArray(control.value) ? control.value.map(String) : [];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className='h-8 min-w-36 justify-between bg-background font-normal'
					disabled={disabled}
				>
					{selected.length > 0 ? `${selected.length} selected` : 'All'}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className='max-h-64 min-w-48 overflow-y-auto'>
				{control.options.map((option) => (
					<DropdownMenuCheckboxItem
						key={option}
						checked={selected.includes(option)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							onChange(
								checked ? [...selected, option] : selected.filter((candidate) => candidate !== option),
							)
						}
					>
						{option}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SliderInput({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	const value = typeof control.value === 'number' ? control.value : Number(control.value ?? control.slider_min ?? 0);
	return (
		<div className='flex h-8 min-w-44 items-center gap-2'>
			<input
				type='range'
				className='flex-1 accent-primary'
				min={control.slider_min ?? undefined}
				max={control.slider_max ?? undefined}
				step={control.slider_step ?? undefined}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
			<span className='w-10 text-right font-mono text-xs text-muted-foreground'>{value}</span>
		</div>
	);
}

function RangeInput({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	const [low, high] = Array.isArray(control.value)
		? control.value.map(Number)
		: [control.slider_min, control.slider_max];
	return (
		<div className='flex h-8 min-w-48 items-center gap-2'>
			<Input
				type='number'
				className='h-8 w-20 bg-background'
				min={control.slider_min ?? undefined}
				max={control.slider_max ?? undefined}
				step={control.slider_step ?? undefined}
				value={low ?? ''}
				disabled={disabled}
				onChange={(event) => onChange([Number(event.target.value), high])}
			/>
			<span className='text-xs text-muted-foreground'>to</span>
			<Input
				type='number'
				className='h-8 w-20 bg-background'
				min={control.slider_min ?? undefined}
				max={control.slider_max ?? undefined}
				step={control.slider_step ?? undefined}
				value={high ?? ''}
				disabled={disabled}
				onChange={(event) => onChange([low, Number(event.target.value)])}
			/>
		</div>
	);
}

function DateRangeInput({
	control,
	disabled,
	onChange,
}: {
	control: DbtChartsControl;
	disabled: boolean;
	onChange: (value: unknown) => void;
}) {
	const [start, end] = Array.isArray(control.value) ? control.value.map(stringValue) : ['', ''];
	return (
		<div className='flex h-8 min-w-64 items-center gap-2'>
			<Input
				type='date'
				className='h-8 bg-background'
				value={start}
				disabled={disabled}
				onChange={(event) => onChange([event.target.value, end])}
			/>
			<span className='text-xs text-muted-foreground'>to</span>
			<Input
				type='date'
				className='h-8 bg-background'
				value={end}
				disabled={disabled}
				onChange={(event) => onChange([start, event.target.value])}
			/>
		</div>
	);
}

function stringValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	return typeof value === 'string' ? value : String(value);
}
