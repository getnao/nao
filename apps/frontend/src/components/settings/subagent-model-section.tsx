import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useId } from 'react';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type AvailableModel = { provider: LlmProvider; modelId: string; name: string; baseUrl: string | null };

const INHERIT_VALUE = '__chat_model__';

interface SubagentModelSectionProps {
	isAdmin: boolean;
}

export function SubagentModelSection({ isAdmin }: SubagentModelSectionProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const defaultModels = useQuery(trpc.project.getDefaultModels.queryOptions());
	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey }),
		}),
	);

	const availableModels = (defaultModels.data?.availableModels ?? []) as AvailableModel[];
	const value = agentSettings.data?.subagent?.model ?? null;
	const disabled = !isAdmin || updateAgentSettings.isPending;

	const handleChange = (selection: LlmSelectedModel | null) => {
		updateAgentSettings.mutate({ subagent: { model: selection } });
	};

	return (
		<SettingsCard
			title='Subagent model'
			description='Subagents run focused side tasks (such as searching the project context) in their own loop. A smaller model here saves cost; the agent can still pick another model when a user explicitly asks for one.'
		>
			{availableModels.length === 0 ? (
				<p className='text-sm text-muted-foreground'>
					No models are available yet. Configure an LLM provider in the{' '}
					<span className='font-medium text-foreground'>LLM Configuration</span> section above.
				</p>
			) : (
				<ModelField
					value={value}
					availableModels={availableModels}
					disabled={disabled}
					onChange={handleChange}
				/>
			)}
		</SettingsCard>
	);
}

function ModelField({
	value,
	availableModels,
	disabled,
	onChange,
}: {
	value: LlmSelectedModel | null;
	availableModels: AvailableModel[];
	disabled: boolean;
	onChange: (selection: LlmSelectedModel | null) => void;
}) {
	const labelId = useId();
	const selected = value
		? availableModels.find((model) => model.provider === value.provider && model.modelId === value.modelId)
		: null;
	const isUnavailable = !!value && !selected;

	const handleChange = (nextValue: string) => {
		if (nextValue === INHERIT_VALUE) {
			onChange(null);
			return;
		}
		const model = availableModels.find((candidate) => modelValue(candidate) === nextValue);
		if (model) {
			onChange({ provider: model.provider, modelId: model.modelId });
		}
	};

	return (
		<div className='grid gap-1.5'>
			<div className='flex items-center gap-2'>
				<label id={labelId} className='text-sm font-medium text-foreground'>
					Default model for subagents
				</label>
				{isUnavailable && (
					<SimpleTooltip content='The selected model is no longer available. Subagents use the chat model until you pick a new one.'>
						<AlertTriangle className='size-3.5 text-amber-500' />
					</SimpleTooltip>
				)}
			</div>
			<Select value={value ? modelValue(value) : INHERIT_VALUE} onValueChange={handleChange} disabled={disabled}>
				<SelectTrigger className='w-full' aria-labelledby={labelId}>
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
							<span className='text-muted-foreground'>Same model as the chat</span>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={INHERIT_VALUE}>Same model as the chat</SelectItem>
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
