import { colorToHex, DEFAULT_THRESHOLD_COLOR } from '@nao/shared/conditional-formatting';
import { getFormattableColumnType } from '@nao/shared/story-table-utils';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type {
	ColumnConditionalFormats,
	ConditionalFormatRule,
	StringOperator,
	StringRule,
	ThresholdOperator,
} from '@nao/shared/conditional-formatting';
import type { FormattableColumnType } from '@nao/shared/story-table-utils';

type RuleKind = 'none' | 'color-scale' | 'threshold' | 'boolean' | 'string';

const RULE_KIND_LABELS: Record<Exclude<RuleKind, 'none'>, string> = {
	'color-scale': 'Color scale',
	threshold: 'Threshold',
	boolean: 'Boolean',
	string: 'String',
};

const RULE_KINDS_BY_TYPE: Record<FormattableColumnType, Exclude<RuleKind, 'none'>[]> = {
	numeric: ['color-scale', 'threshold'],
	boolean: ['boolean'],
	string: ['string'],
};

const OPERATOR_OPTIONS: { value: ThresholdOperator; label: string }[] = [
	{ value: '>=', label: '≥' },
	{ value: '>', label: '>' },
	{ value: '<=', label: '≤' },
	{ value: '<', label: '<' },
	{ value: '=', label: '=' },
];

const STRING_OPERATOR_OPTIONS: { value: StringOperator; label: string }[] = [
	{ value: 'equals', label: 'equals' },
	{ value: 'in', label: 'in list' },
	{ value: 'like', label: 'contains' },
];

const DEFAULT_THRESHOLD_HEX = '#22c55e';
const DEFAULT_SCALE_HEX = '#3b82f6';
const DEFAULT_TRUE_COLOR = 'rgba(34, 197, 94, 0.32)';
const DEFAULT_FALSE_COLOR = 'rgba(239, 68, 68, 0.32)';
const DEFAULT_TRUE_HEX = '#22c55e';
const DEFAULT_FALSE_HEX = '#ef4444';

interface TableFormatEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	columns: string[];
	data: Record<string, unknown>[];
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
	data,
	formats,
	onSave,
	isSaving = false,
	description = 'Apply conditional formatting to table columns.',
}: TableFormatEditDialogProps) {
	const [draft, setDraft] = useState<ColumnConditionalFormats>(formats);
	const [error, setError] = useState<string | null>(null);

	const formattableColumns = useMemo(
		() =>
			columns
				.map((column) => ({ column, type: getFormattableColumnType(data, column) }))
				.filter((entry): entry is { column: string; type: FormattableColumnType } => entry.type !== null),
		[columns, data],
	);

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
					{formattableColumns.length === 0 ? (
						<p className='text-sm text-muted-foreground'>No columns available to format.</p>
					) : (
						formattableColumns.map(({ column, type }) => (
							<ColumnRuleRow
								key={column}
								column={column}
								columnType={type}
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
	columnType: FormattableColumnType;
	rule: ConditionalFormatRule | undefined;
	onChange: (rule: ConditionalFormatRule | undefined) => void;
}

function ColumnRuleRow({ column, columnType, rule, onChange }: ColumnRuleRowProps) {
	const kind: RuleKind = rule?.type ?? 'none';
	const availableKinds = RULE_KINDS_BY_TYPE[columnType];

	const handleKindChange = (value: RuleKind) => {
		onChange(defaultRuleForKind(value));
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
						<SelectItem value='none'>None</SelectItem>
						{availableKinds.map((option) => (
							<SelectItem key={option} value={option}>
								{RULE_KIND_LABELS[option]}
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
						value={toHexColor(rule.color ?? rule.maxColor ?? rule.minColor, DEFAULT_SCALE_HEX)}
						onChange={(color) => onChange({ type: 'color-scale', color, min: rule.min, max: rule.max })}
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

			{rule?.type === 'boolean' && (
				<div className='flex items-center gap-4 pl-0.5'>
					<label className='flex items-center gap-2 text-xs text-muted-foreground'>
						True
						<ColorSwatch
							ariaLabel={`True color for ${column}`}
							value={toHexColor(rule.trueColor, DEFAULT_TRUE_HEX)}
							onChange={(color) => onChange({ ...rule, trueColor: color })}
						/>
					</label>
					<label className='flex items-center gap-2 text-xs text-muted-foreground'>
						False
						<ColorSwatch
							ariaLabel={`False color for ${column}`}
							value={toHexColor(rule.falseColor, DEFAULT_FALSE_HEX)}
							onChange={(color) => onChange({ ...rule, falseColor: color })}
						/>
					</label>
				</div>
			)}

			{rule?.type === 'string' && (
				<div className='flex items-center gap-2 pl-0.5'>
					<Select
						value={rule.operator}
						onValueChange={(operator) => onChange(withStringOperator(rule, operator as StringOperator))}
					>
						<SelectTrigger className='w-28 bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
							{STRING_OPERATOR_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						value={stringValueToText(rule.value)}
						onChange={(e) => onChange({ ...rule, value: textToStringValue(rule.operator, e.target.value) })}
						placeholder={rule.operator === 'in' ? 'value1, value2' : 'value'}
						className='h-8 flex-1 bg-panel'
						aria-label={`Match value for ${column}`}
					/>
					<ColorSwatch
						ariaLabel={`String color for ${column}`}
						value={toHexColor(rule.color, DEFAULT_THRESHOLD_HEX)}
						onChange={(color) => onChange({ ...rule, color })}
					/>
				</div>
			)}
		</div>
	);
}

function defaultRuleForKind(kind: RuleKind): ConditionalFormatRule | undefined {
	switch (kind) {
		case 'none':
			return undefined;
		case 'color-scale':
			return { type: 'color-scale' };
		case 'threshold':
			return { type: 'threshold', operator: '>=', value: 0, color: DEFAULT_THRESHOLD_COLOR };
		case 'boolean':
			return { type: 'boolean', trueColor: DEFAULT_TRUE_COLOR, falseColor: DEFAULT_FALSE_COLOR };
		case 'string':
			return { type: 'string', operator: 'equals', value: '', color: DEFAULT_THRESHOLD_COLOR };
	}
}

function withStringOperator(rule: StringRule, operator: StringOperator): StringRule {
	if (operator === 'in') {
		const value = Array.isArray(rule.value) ? rule.value : textToStringValue('in', String(rule.value ?? ''));
		return { ...rule, operator, value };
	}
	const value = Array.isArray(rule.value) ? rule.value.join(', ') : rule.value;
	return { ...rule, operator, value };
}

function stringValueToText(value: string | string[]): string {
	return Array.isArray(value) ? value.join(', ') : value;
}

function textToStringValue(operator: StringOperator, text: string): string | string[] {
	if (operator !== 'in') {
		return text;
	}
	return text
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
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
