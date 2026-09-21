import type { ModelInferenceSettings, ParamControl, ParamKey, ReasoningEffort } from '@nao/backend/llm';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ParamValues = Partial<Record<ParamKey, string>>;
export type ParamErrors = Partial<Record<ParamKey, string>>;

type NumberControl = Extract<ParamControl, { kind: 'number' }>;
type FieldControl = Extract<ParamControl, { kind: 'number' | 'select' | 'boolean' }>;

const DEFAULT_SENTINEL = '__default__';

interface ModelParametersFieldsProps {
	controls: ParamControl[];
	values: ParamValues;
	onValueChange: (key: ParamKey, value: string) => void;
	errors?: ParamErrors;
}

export function ModelParametersFields({ controls, values, onValueChange, errors = {} }: ModelParametersFieldsProps) {
	const thinkingActive = isThinkingActive(controls, values);
	const effortControls = controls.filter((c): c is Extract<ParamControl, { kind: 'effort' }> => c.kind === 'effort');
	// Some models (Claude, direct or on Vertex/Bedrock) ignore sampling params while thinking is on.
	const fieldControls = controls
		.filter((c): c is FieldControl => c.kind !== 'effort')
		.filter((c) => !isSamplingHiddenByThinking(c, thinkingActive));
	const hidesSamplingWhileThinking = controls.some((c) => isSamplingHiddenByThinking(c, thinkingActive));

	return (
		<div className='grid gap-4'>
			{effortControls.map((control) => {
				const current = values.reasoningEffort ?? 'off';
				return (
					<div key={control.key} className='grid gap-1.5'>
						<span className='text-sm font-medium text-foreground'>{control.label}</span>
						<div className='flex flex-wrap gap-1.5'>
							{control.options.map((option) => {
								const isActive = current === option;
								return (
									<button
										key={option}
										type='button'
										onClick={() => onValueChange('reasoningEffort', option)}
										className={`
											px-3 py-1.5 rounded-md text-sm capitalize transition-all cursor-pointer
											${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}
										`}
									>
										{option === 'off' ? 'Default' : option}
									</button>
								);
							})}
						</div>
					</div>
				);
			})}

			{fieldControls.length > 0 && (
				<div className='grid grid-cols-2 items-start gap-3'>
					{fieldControls.map((control) => {
						if (control.kind === 'select' || control.kind === 'boolean') {
							return (
								<SelectField
									key={control.key}
									control={control}
									value={values[control.key] ?? ''}
									onValueChange={onValueChange}
								/>
							);
						}
						return (
							<NumberField
								key={control.key}
								control={control}
								values={values}
								error={errors[control.key]}
								onValueChange={onValueChange}
							/>
						);
					})}
				</div>
			)}

			<p className='text-xs text-muted-foreground'>
				{hidesSamplingWhileThinking
					? 'Temperature, Top P and Top K are hidden because this model ignores them while thinking is on.'
					: 'Leave a field empty to use the model default.'}
			</p>
		</div>
	);
}

function SelectField({
	control,
	value,
	onValueChange,
}: {
	control: Extract<FieldControl, { kind: 'select' | 'boolean' }>;
	value: string;
	onValueChange: (key: ParamKey, value: string) => void;
}) {
	const options: Array<{ value: string; label: string }> =
		control.kind === 'boolean'
			? [
					{ value: 'true', label: 'On' },
					{ value: 'false', label: 'Off' },
				]
			: control.options.map((option) => ({ value: option, label: option }));

	return (
		<div className='grid gap-1'>
			<label htmlFor={`model-param-${control.key}`} className='text-xs font-medium text-muted-foreground'>
				{control.label}
			</label>
			<Select
				value={value || DEFAULT_SENTINEL}
				onValueChange={(next) => onValueChange(control.key, next === DEFAULT_SENTINEL ? '' : next)}
			>
				<SelectTrigger id={`model-param-${control.key}`} className='w-full'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT_SENTINEL}>Default</SelectItem>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function NumberField({
	control,
	values,
	error,
	onValueChange,
}: {
	control: NumberControl;
	values: ParamValues;
	error: string | undefined;
	onValueChange: (key: ParamKey, value: string) => void;
}) {
	const exclusiveActive = control.exclusiveWith !== undefined && (values[control.exclusiveWith] ?? '').trim() !== '';
	return (
		<div className='grid gap-1'>
			<label htmlFor={`model-param-${control.key}`} className='text-xs font-medium text-muted-foreground'>
				{control.label}
			</label>
			<Input
				id={`model-param-${control.key}`}
				type='number'
				inputMode='decimal'
				step={control.step}
				min={control.min}
				max={control.max}
				disabled={exclusiveActive}
				aria-invalid={!!error}
				className={error ? 'border-destructive focus-visible:ring-destructive' : undefined}
				placeholder={control.placeholder}
				value={values[control.key] ?? ''}
				onChange={(e) => onValueChange(control.key, e.target.value)}
			/>
			{error ? (
				<span className='text-xs text-destructive'>{error}</span>
			) : exclusiveActive ? (
				<span className='text-xs text-muted-foreground'>Ignored while Temperature is set.</span>
			) : null}
		</div>
	);
}

export function seedParamValues(controls: ParamControl[], settings: ModelInferenceSettings | undefined): ParamValues {
	const values: ParamValues = {};
	for (const control of controls) {
		if (control.key === 'reasoningEffort') {
			values.reasoningEffort = settings?.reasoningEffort ?? 'off';
			continue;
		}
		const value = settings?.[control.key];
		values[control.key] = value === undefined ? '' : String(value);
	}
	return values;
}

export function buildInferenceSettings(controls: ParamControl[], values: ParamValues): ModelInferenceSettings {
	const settings: ModelInferenceSettings = {};
	for (const control of controls) {
		const raw = (values[control.key] ?? '').trim();
		if (control.kind === 'effort') {
			if (raw && raw !== 'off') {
				settings.reasoningEffort = raw as ReasoningEffort;
			}
			continue;
		}
		if (!raw) {
			continue;
		}
		if (control.kind === 'number') {
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) {
				settings[control.key] = parsed;
			}
			continue;
		}
		if (control.kind === 'boolean') {
			if (raw === 'true' || raw === 'false') {
				setParamValue(settings, control.key, raw === 'true');
			}
			continue;
		}
		setParamValue(settings, control.key, raw);
	}
	return settings;
}

/**
 * Friendly per-field validation against each control's bounds. Empty fields are
 * valid (= default). Controls hidden by the render (sampling params while
 * thinking is on) are skipped so invisible values can't block saving.
 */
export function getParamErrors(controls: ParamControl[], values: ParamValues): ParamErrors {
	const thinkingActive = isThinkingActive(controls, values);
	const errors: ParamErrors = {};
	for (const control of controls) {
		if (control.kind !== 'number' || isSamplingHiddenByThinking(control, thinkingActive)) {
			continue;
		}
		const raw = (values[control.key] ?? '').trim();
		if (!raw) {
			continue;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			errors[control.key] = 'Enter a valid number.';
			continue;
		}
		if (control.integer && !Number.isInteger(parsed)) {
			errors[control.key] = 'Enter a whole number.';
			continue;
		}
		const belowMin = control.min !== undefined && parsed < control.min;
		const aboveMax = control.max !== undefined && parsed > control.max;
		if (belowMin || aboveMax) {
			errors[control.key] = boundsMessage(control.min, control.max);
			continue;
		}
		const lessThanError = getLessThanError(controls, control, parsed, values);
		if (lessThanError) {
			errors[control.key] = lessThanError;
		}
	}
	return errors;
}

function getLessThanError(
	controls: ParamControl[],
	control: NumberControl,
	parsed: number,
	values: ParamValues,
): string | undefined {
	if (control.lessThan === undefined) {
		return undefined;
	}
	const otherRaw = (values[control.lessThan] ?? '').trim();
	if (!otherRaw) {
		return undefined;
	}
	const other = Number(otherRaw);
	if (!Number.isFinite(other) || parsed < other) {
		return undefined;
	}
	const otherControl = controls.find((c) => c.key === control.lessThan);
	const otherLabel = otherControl?.kind === 'number' ? otherControl.label : control.lessThan;
	return `Must be below ${otherLabel} (${other}).`;
}

function boundsMessage(min: number | undefined, max: number | undefined): string {
	if (min !== undefined && max !== undefined) {
		return `Enter a value between ${min} and ${max}.`;
	}
	if (min !== undefined) {
		return `Enter a value of at least ${min}.`;
	}
	if (max !== undefined) {
		return `Enter a value of at most ${max}.`;
	}
	return 'Enter a valid number.';
}

function isSamplingHiddenByThinking(control: ParamControl, thinkingActive: boolean): boolean {
	return thinkingActive && control.kind === 'number' && control.group === 'sampling';
}

function isThinkingActive(controls: ParamControl[], values: ParamValues): boolean {
	return controls.some((control) => {
		if (control.key === 'reasoningEffort') {
			const effort = values.reasoningEffort;
			return !!effort && effort !== 'off';
		}
		if (control.key === 'thinkingBudgetTokens') {
			return (values.thinkingBudgetTokens ?? '').trim() !== '';
		}
		return false;
	});
}

/** Values originate from the control's own option list, so the narrowing cast is safe. */
function setParamValue(settings: ModelInferenceSettings, key: ParamKey, value: string | boolean): void {
	(settings as Record<string, unknown>)[key] = value;
}
