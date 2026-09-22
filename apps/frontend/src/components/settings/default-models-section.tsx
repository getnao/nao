import {
	BACKGROUND_MODEL_CATEGORIES,
	BACKGROUND_MODEL_CATEGORY_DESCRIPTIONS,
	BACKGROUND_MODEL_CATEGORY_LABELS,
	setBackgroundModelMode,
} from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type { BackgroundModelCategory, BackgroundModelMode, BackgroundModelSettings } from '@nao/shared';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type AvailableModel = { provider: LlmProvider; modelId: string; name: string; baseUrl: string | null };

const DEFAULT_VALUE = '__nao_default__';

interface DefaultModelsSectionProps {
	isAdmin: boolean;
}

export function DefaultModelsSection({ isAdmin }: DefaultModelsSectionProps) {
	const queryClient = useQueryClient();
	const { data } = useQuery(trpc.project.getDefaultModels.queryOptions());
	const updateMutation = useMutation(
		trpc.project.updateDefaultModels.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: trpc.project.getDefaultModels.queryOptions().queryKey }),
		}),
	);

	const availableModels = (data?.availableModels ?? []) as AvailableModel[];
	const settings = data?.settings ?? null;
	const mode: BackgroundModelMode = settings?.mode ?? 'single';
	const disabled = !isAdmin || updateMutation.isPending;
	const hasModels = availableModels.length > 0;

	const save = (next: BackgroundModelSettings) => updateMutation.mutate(next);

	const handleModeChange = (nextMode: BackgroundModelMode) => {
		if (nextMode === mode) {
			return;
		}
		save(setBackgroundModelMode(settings, nextMode));
	};

	const handleSingleChange = (selection: LlmSelectedModel | null) => {
		save({ mode: 'single', single: selection ?? undefined, categories: settings?.categories });
	};

	const handleCategoryChange = (category: BackgroundModelCategory, selection: LlmSelectedModel | null) => {
		const categories = { ...(settings?.categories ?? {}) };
		if (selection) {
			categories[category] = selection;
		} else {
			delete categories[category];
		}
		save({ mode: 'perCategory', single: settings?.single, categories });
	};

	return (
		<SettingsCard
			title='Default models'
			description='Pick which models nao uses for background tasks that run without an explicit model selection. Leave a task on "nao default" to use the built-in choice.'
		>
			{!hasModels ? (
				<p className='text-sm text-muted-foreground'>
					No models are available yet. Configure an LLM provider in the{' '}
					<span className='font-medium text-foreground'>LLM Configuration</span> section above.
				</p>
			) : (
				<div className='flex flex-col gap-5'>
					<ModeToggle mode={mode} onChange={handleModeChange} disabled={disabled} />

					{mode === 'single' ? (
						<ModelField
							label='Default for every task'
							description='Used for every background task listed below.'
							value={settings?.single}
							availableModels={availableModels}
							disabled={disabled}
							onChange={handleSingleChange}
						/>
					) : (
						<div className='flex flex-col gap-4'>
							{BACKGROUND_MODEL_CATEGORIES.map((category) => (
								<ModelField
									key={category}
									label={BACKGROUND_MODEL_CATEGORY_LABELS[category]}
									description={BACKGROUND_MODEL_CATEGORY_DESCRIPTIONS[category]}
									value={settings?.categories?.[category]}
									availableModels={availableModels}
									disabled={disabled}
									onChange={(selection) => handleCategoryChange(category, selection)}
								/>
							))}
						</div>
					)}
				</div>
			)}
		</SettingsCard>
	);
}

function ModeToggle({
	mode,
	onChange,
	disabled,
}: {
	mode: BackgroundModelMode;
	onChange: (mode: BackgroundModelMode) => void;
	disabled: boolean;
}) {
	const options: { value: BackgroundModelMode; label: string }[] = [
		{ value: 'single', label: 'One default for everything' },
		{ value: 'perCategory', label: 'A model per task' },
	];

	return (
		<div className='inline-flex w-fit rounded-lg border border-border p-0.5'>
			{options.map((option) => (
				<button
					key={option.value}
					type='button'
					disabled={disabled}
					onClick={() => onChange(option.value)}
					className={cn(
						'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
						mode === option.value
							? 'bg-secondary text-foreground'
							: 'text-muted-foreground hover:text-foreground',
						disabled && 'cursor-not-allowed opacity-60',
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function ModelField({
	label,
	description,
	value,
	availableModels,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	value: LlmSelectedModel | undefined;
	availableModels: AvailableModel[];
	disabled: boolean;
	onChange: (selection: LlmSelectedModel | null) => void;
}) {
	const labelId = useId();
	const descriptionId = useId();
	const selected = value
		? availableModels.find((m) => m.provider === value.provider && m.modelId === value.modelId)
		: null;
	const isUnavailable = !!value && !selected;

	const handleChange = (nextValue: string) => {
		if (nextValue === DEFAULT_VALUE) {
			onChange(null);
			return;
		}
		const model = availableModels.find((m) => modelValue(m) === nextValue);
		if (model) {
			onChange({ provider: model.provider, modelId: model.modelId });
		}
	};

	return (
		<div className='grid gap-1.5'>
			<div className='flex items-center gap-2'>
				<label id={labelId} className='text-sm font-medium text-foreground'>
					{label}
				</label>
				{isUnavailable && (
					<SimpleTooltip content='The selected model is no longer available. nao automatically falls back to another available model until you pick a new one.'>
						<AlertTriangle className='size-3.5 text-amber-500' />
					</SimpleTooltip>
				)}
			</div>
			<p id={descriptionId} className='text-xs text-muted-foreground'>
				{description}
			</p>
			<Select value={value ? modelValue(value) : DEFAULT_VALUE} onValueChange={handleChange} disabled={disabled}>
				<SelectTrigger className='w-full' aria-labelledby={labelId} aria-describedby={descriptionId}>
					<SelectValue>
						{value ? (
							<div className='flex items-center gap-2'>
								<LlmProviderIcon
									provider={value.provider}
									baseUrl={selected?.baseUrl ?? null}
									className='size-4'
								/>
								<span className={cn(isUnavailable && 'text-amber-600 dark:text-amber-500')}>
									{selected?.name ?? value.modelId}
								</span>
							</div>
						) : (
							<span className='text-muted-foreground'>nao default (automatic)</span>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT_VALUE}>nao default (automatic)</SelectItem>
					{availableModels.map((model) => (
						<SelectItem key={modelValue(model)} value={modelValue(model)}>
							<LlmProviderIcon provider={model.provider} baseUrl={model.baseUrl} className='size-4' />
							{model.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function modelValue(model: { provider: string; modelId: string }): string {
	return JSON.stringify([model.provider, model.modelId]);
}
