import { providerLabel, providerName } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Settings, TriangleAlert } from 'lucide-react';

import type { LlmProvider } from '@nao/shared/types';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentContext } from '@/contexts/agent.provider';
import { isSameModel, useModelSelection } from '@/hooks/use-model-selection';
import { usePermissions } from '@/hooks/use-permissions';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { trpc } from '@/main';

/** Listed as an option rather than a link, so that the keyboard reaches it like any other. */
const MANAGE_MODELS_VALUE = 'manage-models';

export function ChatInputModelSelect() {
	const navigate = useNavigate();
	const { isAdmin } = usePermissions();
	const { availableModels, selectedModel, setSelectedModel, isPending, canCycleModels } = useModelSelection();
	const { isTooltipOpen, onTooltipOpenChange, onSelectOpenChange } = useSelectTriggerTooltip();

	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isTrial = project.data === null;

	const isOnboarding = useAgentContext().mode === 'onboarding';

	// Set default model when available models load, or reset if current selection is no longer available
	useEffect(() => {
		if (!availableModels || availableModels.length === 0) {
			return;
		}

		if (!availableModels.some((model) => isSameModel(model, selectedModel))) {
			setSelectedModel(availableModels[0]);
		}
	}, [availableModels, selectedModel, setSelectedModel]);

	const handleModelValueChange = useCallback(
		(value: string) => {
			if (value === MANAGE_MODELS_VALUE) {
				navigate({ to: '/settings/project/models' });
				return;
			}
			const model = availableModels?.find((m) => `${m.provider}:${m.modelId}` === value);
			if (model) {
				setSelectedModel(model);
			}
		},
		[availableModels, navigate, setSelectedModel],
	);

	const selectedAvailableModel = selectedModel
		? availableModels?.find((model) => isSameModel(model, selectedModel))
		: undefined;
	const selectedModelName = selectedAvailableModel?.name ?? selectedModel?.modelId ?? 'Select model';

	if (isPending) {
		return null;
	}

	if (!availableModels?.length && !isOnboarding && !isTrial) {
		return (
			<Link
				to='/settings/project/models'
				className='flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors'
			>
				<TriangleAlert className='size-3.5' />
				<span>Configure a model</span>
			</Link>
		);
	}

	if (isOnboarding) {
		const singleModel = (
			<>
				{selectedModel && (
					<LlmProviderIcon
						provider={selectedModel.provider}
						baseUrl={selectedAvailableModel?.baseUrl}
						className='size-4'
					/>
				)}
				<span>{selectedModelName}</span>
				{selectedModel && <NamedProviderHint provider={selectedModel.provider} />}
			</>
		);
		return (
			<div className='flex items-center gap-2 text-sm font-normal text-muted-foreground'>
				{singleModel}
				<span className='text-sm'>Onboarding Assistant</span>
			</div>
		);
	}

	if (isTrial && !isOnboarding) {
		const singleModel = (
			<>
				{selectedModel && (
					<LlmProviderIcon
						provider={selectedModel.provider}
						baseUrl={selectedAvailableModel?.baseUrl}
						className='size-4'
					/>
				)}
				<span>{selectedModelName}</span>
				{selectedModel && <NamedProviderHint provider={selectedModel.provider} />}
			</>
		);
		return (
			<div className='flex items-center gap-2 text-sm font-normal text-muted-foreground'>
				{singleModel}
				<span className='text-sm text-muted-foreground'>Trial</span>
			</div>
		);
	}

	if (!canCycleModels) {
		const singleModel = (
			<>
				{selectedModel && (
					<LlmProviderIcon
						provider={selectedModel.provider}
						baseUrl={selectedAvailableModel?.baseUrl}
						className='size-4'
					/>
				)}
				<span>{selectedModelName}</span>
				{selectedModel && <NamedProviderHint provider={selectedModel.provider} />}
			</>
		);

		if (!isAdmin) {
			return (
				<div className='flex items-center gap-2 text-sm font-normal text-muted-foreground'>{singleModel}</div>
			);
		}

		return (
			<Link
				to='/settings/project/models'
				className='flex items-center gap-2 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors'
			>
				{singleModel}
			</Link>
		);
	}

	return (
		<Select
			value={selectedModel ? `${selectedModel.provider}:${selectedModel.modelId}` : undefined}
			onValueChange={handleModelValueChange}
			onOpenChange={onSelectOpenChange}
		>
			<Tooltip open={isTooltipOpen} onOpenChange={onTooltipOpenChange}>
				<TooltipTrigger asChild>
					<SelectTrigger variant='ghost' className='p-0 gap-1 text-sm' size='sm'>
						<SelectValue>
							<div className='flex items-center gap-2'>
								{selectedModel && (
									<LlmProviderIcon
										provider={selectedModel.provider}
										baseUrl={selectedAvailableModel?.baseUrl}
										className='size-4'
									/>
								)}
								<span className='leading-none'>{selectedModelName}</span>
								{selectedModel && <NamedProviderHint provider={selectedModel.provider} />}
							</div>
						</SelectValue>
					</SelectTrigger>
				</TooltipTrigger>
				<TooltipContent side='top'>Cycle models with {getShortcutLabel('cycle-model')}</TooltipContent>
			</Tooltip>

			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				{availableModels?.map((model) => (
					<SelectItem key={`${model.provider}-${model.modelId}`} value={`${model.provider}:${model.modelId}`}>
						<LlmProviderIcon
							provider={model.provider}
							baseUrl={model.baseUrl}
							className='size-4 opacity-100'
						/>
						{model.name}
						<NamedProviderHint provider={model.provider} />
					</SelectItem>
				))}

				{isAdmin && (
					<>
						<SelectSeparator />
						<SelectItem value={MANAGE_MODELS_VALUE} className='text-muted-foreground'>
							<Settings className='size-4' />
							Manage models
						</SelectItem>
					</>
				)}
			</SelectContent>
		</Select>
	);
}

/**
 * Closing the select returns focus to its trigger, which would otherwise open the
 * tooltip and keep it visible. The open request caused by that focus is skipped.
 */
function useSelectTriggerTooltip() {
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);
	const skipNextOpenRef = useRef(false);

	const onSelectOpenChange = useCallback((open: boolean) => {
		setIsTooltipOpen(false);
		skipNextOpenRef.current = !open;
	}, []);

	const onTooltipOpenChange = useCallback((open: boolean) => {
		if (open && skipNextOpenRef.current) {
			skipNextOpenRef.current = false;
			return;
		}
		setIsTooltipOpen(open);
	}, []);

	return { isTooltipOpen, onTooltipOpenChange, onSelectOpenChange };
}

function NamedProviderHint({ provider }: { provider: LlmProvider }) {
	const name = providerName(provider);
	if (!name) {
		return null;
	}
	return <span className='text-muted-foreground'>{providerLabel(provider)}</span>;
}
