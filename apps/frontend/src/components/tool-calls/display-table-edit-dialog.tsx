import { colorToHex, DEFAULT_THRESHOLD_COLOR } from '@nao/shared/conditional-formatting';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type {
	ColumnConditionalFormats,
	ConditionalFormatRule,
	ThresholdOperator,
} from '@nao/shared/conditional-formatting';

type RuleKind = 'none' | 'color-scale' | 'threshold';

const RULE_KIND_OPTIONS: { value: RuleKind; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'color-scale', label: 'Color scale' },
	{ value: 'threshold', label: 'Threshold' },
];

const OPERATOR_OPTIONS: { value: ThresholdOperator; label: string }[] = [
	{ value: '>=', label: '≥' },
	{ value: '>', label: '>' },
	{ value: '<=', label: '≤' },
	{ value: '<', label: '<' },
	{ value: '=', label: '=' },
];

const DEFAULT_THRESHOLD_HEX = '#22c55e';
const DEFAULT_SCALE_HEX = '#3b82f6';

interface TableFormatEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	columns: string[];
	formats: ColumnConditionalFormats;
	onSave: (next: ColumnConditionalFormats) => Promise<void>;
	isSaving?: boolean;
	description?: string;
}

/** Presentational dialog for editing per-column conditional formatting. */
export function TableFormatEditDialog({
	open,
	onOpenChange,
	columns,
	formats,
	onSave,
	isSaving = false,
	description = 'Apply conditional formatting to table columns.',
}: TableFormatEditDialogProps) {
	const [draft, setDraft] = useState<ColumnConditionalFormats>(formats);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(formats);
			setError(null);
		}
	}, [open, formats]);

	const setColumnRule = (column: string, rule: ConditionalFormatRule | undefined) => {
		setDraft((prev) => {
			const next = { ...prev };
			if (rule) {
				next[column] = rule;
			} else {
				delete next[column];
			}
			return next;
		});
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		try {
			await onSave(draft);
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update formatting.');
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-xl max-h-[90vh] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>Edit table formatting</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						{description}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-3'>
					{columns.length === 0 ? (
						<p className='text-sm text-muted-foreground'>No columns available to format.</p>
					) : (
						columns.map((column) => (
							<ColumnRuleRow
								key={column}
								column={column}
								rule={draft[column]}
								onChange={(rule) => setColumnRule(column, rule)}
							/>
						))
					)}

					{error && <p className='text-xs text-destructive'>{error}</p>}

					<DialogFooter>
						<Button
							type='button'
							variant='ghost'
							className='rounded-full border'
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							variant='primary-gradient'
							type='submit'
							className='rounded-full'
							isLoading={isSaving}
							disabled={isSaving}
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface ColumnRuleRowProps {
	column: string;
	rule: ConditionalFormatRule | undefined;
	onChange: (rule: ConditionalFormatRule | undefined) => void;
}

function ColumnRuleRow({ column, rule, onChange }: ColumnRuleRowProps) {
	const kind: RuleKind = rule?.type ?? 'none';

	const handleKindChange = (value: RuleKind) => {
		if (value === 'none') {
			onChange(undefined);
		} else if (value === 'color-scale') {
			onChange({ type: 'color-scale' });
		} else {
			onChange({ type: 'threshold', operator: '>=', value: 0, color: DEFAULT_THRESHOLD_COLOR });
		}
	};

	return (
		<div className='flex flex-col gap-2 rounded-md border border-border/60 p-2'>
			<div className='grid grid-cols-[1fr_auto] items-center gap-2'>
				<span className='truncate text-sm font-medium text-foreground'>{column}</span>
				<Select value={kind} onValueChange={(value) => handleKindChange(value as RuleKind)}>
					<SelectTrigger className='w-36 bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
						{RULE_KIND_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{rule?.type === 'color-scale' && (
				<div className='flex items-center gap-2 pl-0.5'>
					<span className='text-xs text-muted-foreground'>Color</span>
					<ColorSwatch
						ariaLabel={`Color scale color for ${column}`}
						value={toHexColor(rule.color, DEFAULT_SCALE_HEX)}
						onChange={(color) => onChange({ ...rule, color })}
					/>
				</div>
			)}

			{rule?.type === 'threshold' && (
				<div className='flex items-center gap-2 pl-0.5'>
					<Select
						value={rule.operator}
						onValueChange={(operator) => onChange({ ...rule, operator: operator as ThresholdOperator })}
					>
						<SelectTrigger className='w-16 bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
							{OPERATOR_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						type='number'
						value={Number.isFinite(rule.value) ? rule.value : 0}
						onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
						className='h-8 w-24 bg-panel'
						aria-label={`Threshold value for ${column}`}
					/>
					<ColorSwatch
						ariaLabel={`Threshold color for ${column}`}
						value={toHexColor(rule.color, DEFAULT_THRESHOLD_HEX)}
						onChange={(color) => onChange({ ...rule, color })}
					/>
				</div>
			)}
		</div>
	);
}

function ColorSwatch({
	ariaLabel,
	value,
	onChange,
}: {
	ariaLabel: string;
	value: string;
	onChange: (color: string) => void;
}) {
	return (
		<input
			type='color'
			aria-label={ariaLabel}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className='h-8 w-8 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-none'
		/>
	);
}

function toHexColor(color: string | undefined, fallback: string): string {
	return (color ? colorToHex(color) : null) ?? fallback;
}
