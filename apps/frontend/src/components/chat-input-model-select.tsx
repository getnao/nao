import { isSameModel, providerLabel, providerName } from '@nao/shared/types';
import { Link, useNavigate } from '@tanstack/react-router';
import { LockKeyhole, Settings, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { LlmModelOption } from '@/lib/llm-model';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useModelSelection } from '@/hooks/use-model-selection';
import { usePermissions } from '@/hooks/use-permissions';
import { getShortcut, getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { llmModelValue, toLlmSelectedModel } from '@/lib/llm-model';
import { matchesShortcut } from '@/lib/platform';

/** Listed as an option rather than a link, so that the keyboard reaches it like any other. */
const MANAGE_MODELS_VALUE = 'manage-models';
/** Follows the default chat model set by the admin instead of pinning a model. */
const NAO_DEFAULT_VALUE = 'nao-default';
const NAO_DEFAULT_LABEL = 'Auto';
const EXAMPLE_MODEL_VALUE = 'example-model';
const PROJECT_SETUP_VALUE = 'project-setup';
const EXAMPLE_MODEL_NAME = 'GPT 6 Sol';
const cycleModelShortcut = getShortcut('cycle-model').shortcut;

export function ChatInputModelSelect({
	isExample = false,
	managedCreditsExhausted = false,
}: {
	isExample?: boolean;
	managedCreditsExhausted?: boolean;
}) {
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
		cycleModel,
		hasProject,
	} = useModelSelection();
	const { isTooltipOpen, onTooltipOpenChange, onSelectOpenChange } = useSelectTriggerTooltip();

	// Fall back to the nao default when the pinned model is no longer available
	useEffect(() => {
		if (usesDefaultModel || !availableModels || availableModels.length === 0) {
			return;
		}
		if (!selectedModel || !availableModels.some((model) => isSameModel(model, selectedModel))) {
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
			const model = availableModels?.find((candidate) => llmModelValue(candidate) === value);
			if (model) {
				setSelectedModel(toLlmSelectedModel(model));
			}
		},
		[availableModels, navigate, setSelectedModel],
	);
	const handleCycleModelShortcut = useCallback(
		(event: KeyboardEvent<HTMLButtonElement>) => {
			if (!matchesShortcut(event.nativeEvent, cycleModelShortcut)) {
				return;
			}
			event.preventDefault();
			if (managedCreditsExhausted) {
				const nextConfiguredModel = availableModels?.find((model) => model.provider !== 'nao');
				if (nextConfiguredModel) {
					setSelectedModel(nextConfiguredModel);
				}
				return;
			}
			cycleModel();
		},
		[availableModels, cycleModel, managedCreditsExhausted, setSelectedModel],
	);

	const selectedAvailableModel = selectedModel
		? availableModels?.find((model) => isSameModel(model, selectedModel))
		: undefined;
	const defaultAvailableModel = defaultModel
		? availableModels?.find((model) => isSameModel(model, defaultModel))
		: undefined;
	const isDefaultManagedModel = defaultModel?.provider === 'nao';
	const resolvedModelName = selectedAvailableModel?.name ?? selectedModel?.modelId;
	const selectedModelName = usesDefaultModel ? NAO_DEFAULT_LABEL : (resolvedModelName ?? 'Select model');
	const selectValue = usesDefaultModel ? NAO_DEFAULT_VALUE : selectedModel ? llmModelValue(selectedModel) : undefined;

	if (isExample) {
		return <ExampleModel />;
	}

	if (isPending) {
		return null;
	}

	if (!availableModels?.length) {
		if (!hasProject) {
			return <ExampleModel />;
		}
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
			{selectedModel && <ModelSourceHint model={selectedAvailableModel ?? selectedModel} />}
		</>
	);

	if (!canCycleModels) {
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
					<SelectTrigger
						variant='ghost'
						className='p-0 gap-1 text-sm'
						size='sm'
						onKeyDown={handleCycleModelShortcut}
					>
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
									: selectedModel && (
											<ModelSourceHint model={selectedAvailableModel ?? selectedModel} />
										)}
							</div>
						</SelectValue>
					</SelectTrigger>
				</TooltipTrigger>
				<TooltipContent side='top'>Cycle models with {getShortcutLabel('cycle-model')}</TooltipContent>
			</Tooltip>

			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				<SelectItem value={NAO_DEFAULT_VALUE} disabled={managedCreditsExhausted && isDefaultManagedModel}>
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
					{managedCreditsExhausted && isDefaultManagedModel && <ManagedCreditsLock />}
				</SelectItem>
				<SelectSeparator />

				{availableModels?.map((model) => (
					<SelectItem
						key={llmModelValue(model)}
						value={llmModelValue(model)}
						disabled={managedCreditsExhausted && model.provider === 'nao'}
					>
						<LlmProviderIcon
							provider={model.provider}
							baseUrl={model.baseUrl}
							className='size-4 opacity-100'
						/>
						{model.name}
						<ModelSourceHint model={model} />
						{managedCreditsExhausted && model.provider === 'nao' && <ManagedCreditsLock />}
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

function ExampleModel() {
	return (
		<Select value={EXAMPLE_MODEL_VALUE}>
			<SelectTrigger variant='ghost' className='p-0 gap-1 text-sm' size='sm' aria-label='Model'>
				<SelectValue>
					<div className='flex items-center gap-2'>
						<LlmProviderIcon provider='nao' className='size-4' />
						<span className='leading-none'>{EXAMPLE_MODEL_NAME}</span>
					</div>
				</SelectValue>
			</SelectTrigger>
			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				<SelectItem value={EXAMPLE_MODEL_VALUE}>
					<LlmProviderIcon provider='nao' className='size-4 opacity-100' />
					{EXAMPLE_MODEL_NAME}
				</SelectItem>
				<SelectSeparator />
				<SelectItem value={PROJECT_SETUP_VALUE} disabled className='text-muted-foreground'>
					<Settings className='size-4' />
					Set up a project to switch models
				</SelectItem>
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

function ModelSourceHint({ model }: { model: LlmModelOption }) {
	if (model.llmConfigName) {
		return <span className='text-muted-foreground'>{model.llmConfigName}</span>;
	}
	const name = providerName(model.provider);
	if (!name) {
		return null;
	}
	return <span className='text-muted-foreground'>{providerLabel(model.provider)}</span>;
}

function ManagedCreditsLock() {
	return <LockKeyhole className='size-3.5' aria-label='Unavailable: nao credits exhausted' />;
}
