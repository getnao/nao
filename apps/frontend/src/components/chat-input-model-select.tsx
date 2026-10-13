import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Settings, TriangleAlert } from 'lucide-react';
import { providerLabel, providerName } from '@nao/shared/types';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { isSameModel, useModelSelection } from '@/hooks/use-model-selection';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';

/** Listed as an option rather than a link, so that the keyboard reaches it like any other. */
const MANAGE_MODELS_VALUE = 'manage-models';
/** Follows the default chat model set by the admin instead of pinning a model. */
const NAO_DEFAULT_VALUE = 'nao-default';
const NAO_DEFAULT_LABEL = 'Auto';

export function ChatInputModelSelect() {
	const navigate = useNavigate();
	const { isAdmin } = usePermissions();
	const {
		availableModels,
		defaultModel,
		selectedModel,
		usesDefaultModel,
		setSelectedModel,
		isPending,
		canCycleModels,
	} = useModelSelection();
	const { isTooltipOpen, onTooltipOpenChange, onSelectOpenChange } = useSelectTriggerTooltip();

	// Fall back to the nao default when the pinned model is no longer available
	useEffect(() => {
		if (usesDefaultModel || !availableModels || availableModels.length === 0) {
			return;
		}
		if (!availableModels.some((model) => isSameModel(model, selectedModel))) {
			setSelectedModel(null);
		}
	}, [usesDefaultModel, availableModels, selectedModel, setSelectedModel]);

	const handleModelValueChange = useCallback(
		(value: string) => {
			if (value === MANAGE_MODELS_VALUE) {
				navigate({ to: '/settings/project/models' });
				return;
			}
			if (value === NAO_DEFAULT_VALUE) {
				setSelectedModel(null);
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
	const defaultAvailableModel = defaultModel
		? availableModels?.find((model) => isSameModel(model, defaultModel))
		: undefined;
	const resolvedModelName = selectedAvailableModel?.name ?? selectedModel?.modelId;
	const selectedModelName = usesDefaultModel ? NAO_DEFAULT_LABEL : (resolvedModelName ?? 'Select model');
	const selectValue = usesDefaultModel ? NAO_DEFAULT_VALUE : selectedModel ? modelValue(selectedModel) : undefined;

	if (isPending) {
		return null;
	}

	if (!availableModels?.length) {
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
				<span>{resolvedModelName ?? 'Select model'}</span>
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
		<Select value={selectValue} onValueChange={handleModelValueChange} onOpenChange={onSelectOpenChange}>
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
								{usesDefaultModel
									? resolvedModelName && (
											<span className='text-muted-foreground'>{resolvedModelName}</span>
										)
									: selectedModel && <NamedProviderHint provider={selectedModel.provider} />}
							</div>
						</SelectValue>
					</SelectTrigger>
				</TooltipTrigger>
				<TooltipContent side='top'>Cycle models with {getShortcutLabel('cycle-model')}</TooltipContent>
			</Tooltip>

			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				<SelectItem value={NAO_DEFAULT_VALUE}>
					{defaultModel && (
						<LlmProviderIcon
							provider={defaultModel.provider}
							baseUrl={defaultAvailableModel?.baseUrl}
							className='size-4 opacity-100'
						/>
					)}
					{NAO_DEFAULT_LABEL}
					{defaultAvailableModel && (
						<span className='text-muted-foreground'>{defaultAvailableModel.name}</span>
					)}
				</SelectItem>
				<SelectSeparator />

				{availableModels.map((model) => (
					<SelectItem key={`${model.provider}-${model.modelId}`} value={modelValue(model)}>
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

function modelValue(model: LlmSelectedModel): string {
	return `${model.provider}:${model.modelId}`;
}

function NamedProviderHint({ provider }: { provider: LlmProvider }) {
	const name = providerName(provider);
	if (!name) {
		return null;
	}
	return <span className='text-muted-foreground'>{providerLabel(provider)}</span>;
}
