import { isSameModel } from '@nao/shared/types';
import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { llmModelValue, toLlmSelectedModel } from '@/lib/llm-model';
import { cn } from '@/lib/utils';

export type AvailableModel = {
	provider: LlmProvider;
	modelId: string;
	name: string;
	baseUrl: string | null;
	llmConfigId?: string;
	llmConfigName?: string;
};
export type ResolvedModel = LlmSelectedModel & { name: string };

/** The entry offered on top of the model list, standing for "let nao decide". */
export interface DefaultModelOption {
	label: string;
	model?: ResolvedModel | null;
	hint?: string;
}

const DEFAULT_VALUE = '__nao_default__';

const FALLBACK_UNAVAILABLE_WARNING =
	'The selected model is no longer available. nao automatically falls back to another available model until you pick a new one.';

export function ModelSelectField({
	icon,
	label,
	description,
	value,
	unavailableWarning = FALLBACK_UNAVAILABLE_WARNING,
	defaultOption,
	availableModels,
	disabled,
	onChange,
}: {
	icon?: ReactNode;
	label: ReactNode;
	description: ReactNode;
	value: LlmSelectedModel | null | undefined;
	unavailableWarning?: string;
	defaultOption: DefaultModelOption;
	availableModels: AvailableModel[];
	disabled: boolean;
	onChange: (selection: LlmSelectedModel | null) => void;
}) {
	const labelId = useId();
	const descriptionId = useId();
	const selected = value ? findModel(availableModels, value) : null;
	const isUnavailable = !!value && !selected;

	const handleChange = (nextValue: string) => {
		if (nextValue === DEFAULT_VALUE) {
			onChange(null);
			return;
		}
		const model = availableModels.find((m) => llmModelValue(m) === nextValue);
		if (model) {
			onChange(toLlmSelectedModel(model));
		}
	};

	return (
		<div className='grid gap-1.5'>
			<div className='flex items-center gap-2'>
				{icon}
				<label id={labelId} className='text-sm font-medium text-foreground'>
					{label}
				</label>
				{isUnavailable && (
					<SimpleTooltip content={unavailableWarning}>
						<AlertTriangle className='size-3.5 text-amber-500' />
					</SimpleTooltip>
				)}
			</div>
			<p id={descriptionId} className='text-xs text-muted-foreground'>
				{description}
			</p>
			<Select
				value={value ? llmModelValue(value) : DEFAULT_VALUE}
				onValueChange={handleChange}
				disabled={disabled}
			>
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
								{selected?.llmConfigName && (
									<span className='text-muted-foreground'>{selected.llmConfigName}</span>
								)}
							</div>
						) : (
							<DefaultOptionContent option={defaultOption} availableModels={availableModels} />
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT_VALUE}>
						<DefaultOptionContent option={defaultOption} availableModels={availableModels} />
					</SelectItem>
					{availableModels.map((model) => (
						<SelectItem key={llmModelValue(model)} value={llmModelValue(model)}>
							<LlmProviderIcon provider={model.provider} baseUrl={model.baseUrl} className='size-4' />
							{model.name}
							{model.llmConfigName && (
								<span className='text-muted-foreground'>{model.llmConfigName}</span>
							)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function DefaultOptionContent({
	option,
	availableModels,
}: {
	option: DefaultModelOption;
	availableModels: AvailableModel[];
}) {
	const { label, model, hint } = option;
	const detail = model ? model.name : hint;

	return (
		<div className='flex items-center gap-2'>
			{model && (
				<LlmProviderIcon
					provider={model.provider}
					baseUrl={findModel(availableModels, model)?.baseUrl ?? null}
					className='size-4'
				/>
			)}
			<span className='text-muted-foreground'>
				{label}
				{detail && <span> · {detail}</span>}
			</span>
		</div>
	);
}

export function findModel(availableModels: AvailableModel[], model: LlmSelectedModel): AvailableModel | undefined {
	return availableModels.find((candidate) => isSameModel(candidate, model));
}
