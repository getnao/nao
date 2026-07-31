import { useCallback, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Settings, TriangleAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { isSameModel, useModelSelection } from '@/hooks/use-model-selection';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';

/** Listed as an option rather than a link, so that the keyboard reaches it like any other. */
const MANAGE_MODELS_VALUE = 'manage-models';

export function ChatInputModelSelect() {
	const navigate = useNavigate();
	const { isAdmin } = usePermissions();
	const { availableModels, selectedModel, setSelectedModel, isPending, canCycleModels } = useModelSelection();

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

	const selectedModelName = selectedModel
		? (availableModels?.find((model) => isSameModel(model, selectedModel))?.name ?? selectedModel.modelId)
		: 'Select model';

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
				{selectedModel && <LlmProviderIcon provider={selectedModel.provider} className='size-4' />}
				<span>{selectedModelName}</span>
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
		>
			<SimpleTooltip side='top' content={`Cycle models with ${getShortcutLabel('cycle-model')}`}>
				<SelectTrigger variant='ghost' className='p-0 gap-1 text-sm' size='sm'>
					<SelectValue>
						<div className='flex items-center gap-2'>
							{selectedModel && <LlmProviderIcon provider={selectedModel.provider} className='size-4' />}
							<span className='leading-none'>{selectedModelName}</span>
						</div>
					</SelectValue>
				</SelectTrigger>
			</SimpleTooltip>

			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				{availableModels.map((model) => (
					<SelectItem key={`${model.provider}-${model.modelId}`} value={`${model.provider}:${model.modelId}`}>
						<LlmProviderIcon provider={model.provider} className='size-4 opacity-100' />
						{model.name}
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
