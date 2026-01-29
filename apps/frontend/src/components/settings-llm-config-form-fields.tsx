import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { getDefaultModelId } from 'backend/providers';
import type { LlmProvider } from 'backend/llm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ConfigFormState {
	provider: LlmProvider | '';
	apiKey: string;
	enabledModels: string[];
	baseUrl: string;
	isEditing: boolean;
	usesEnvKey: boolean;
}

export const initialFormState: ConfigFormState = {
	provider: '',
	apiKey: '',
	enabledModels: [],
	baseUrl: '',
	isEditing: false,
	usesEnvKey: false,
};

export interface ModelInfo {
	id: string;
	name: string;
	default?: boolean;
}

interface ConfigFormFieldsProps {
	formState: ConfigFormState;
	setFormState: React.Dispatch<React.SetStateAction<ConfigFormState>>;
	currentModels: readonly ModelInfo[];
	customModelInput: string;
	setCustomModelInput: (value: string) => void;
	showAdvanced: boolean;
	setShowAdvanced: (value: boolean) => void;
	error: { message: string } | null;
	isSaveDisabled: boolean;
	onSave: () => void;
	onCancel: () => void;
	apiKeyHint: string;
	apiKeyPlaceholder: string;
	saveButtonText: string;
	showPlusIcon?: boolean;
}

export function ConfigFormFields({
	formState,
	setFormState,
	currentModels,
	customModelInput,
	setCustomModelInput,
	showAdvanced,
	setShowAdvanced,
	error,
	isSaveDisabled,
	onSave,
	onCancel,
	apiKeyHint,
	apiKeyPlaceholder,
	saveButtonText,
	showPlusIcon = false,
}: ConfigFormFieldsProps) {
	const isCustomModel = (modelId: string) => !currentModels.some((m) => m.id === modelId);

	const toggleModel = (modelId: string) => {
		setFormState((prev) => {
			if (prev.enabledModels.includes(modelId)) {
				return {
					...prev,
					enabledModels: prev.enabledModels.filter((m) => m !== modelId),
				};
			}

			// First selection while default is implicitly selected - keep the default too
			if (prev.enabledModels.length === 0) {
				const defaultModel = currentModels.find((m) => m.default);
				if (defaultModel && defaultModel.id !== modelId) {
					return {
						...prev,
						enabledModels: [defaultModel.id, modelId],
					};
				}
			}

			return {
				...prev,
				enabledModels: [...prev.enabledModels, modelId],
			};
		});
	};

	const handleAddCustomModel = () => {
		const trimmed = customModelInput.trim();
		if (!trimmed || formState.enabledModels.includes(trimmed)) {
			return;
		}
		setFormState((prev) => ({
			...prev,
			enabledModels: [...prev.enabledModels, trimmed],
		}));
		setCustomModelInput('');
	};

	return (
		<>
			{/* API Key field */}
			<div className='grid gap-2'>
				<label htmlFor='api-key' className='text-sm font-medium text-foreground'>
					API Key
					{apiKeyHint && <span className='text-muted-foreground font-normal ml-1'>{apiKeyHint}</span>}
				</label>
				<Input
					id='api-key'
					type='password'
					value={formState.apiKey}
					onChange={(e) => setFormState((prev) => ({ ...prev, apiKey: e.target.value }))}
					placeholder={apiKeyPlaceholder}
				/>
			</div>

			{/* Model selection */}
			<div className='grid gap-2'>
				<label className='text-sm font-medium text-foreground'>
					Enabled Models
					<span className='text-muted-foreground font-normal ml-1'>
						(leave empty for default {formState.provider && getDefaultModelId(formState.provider)})
					</span>
				</label>
				<div className='flex flex-wrap gap-2'>
					{currentModels.map((model) => {
						const isExplicitlyEnabled = formState.enabledModels.includes(model.id);
						const isDefaultSelected = formState.enabledModels.length === 0 && model.default;
						const isEnabled = isExplicitlyEnabled || isDefaultSelected;
						return (
							<button
								key={model.id}
								type='button'
								onClick={() => toggleModel(model.id)}
								className={`
									flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer
									${isEnabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}
								`}
							>
								{isEnabled && <Check className='size-3' />}
								{model.name}
							</button>
						);
					})}
					{formState.enabledModels.filter(isCustomModel).map((modelId) => (
						<button
							key={modelId}
							type='button'
							onClick={() => toggleModel(modelId)}
							className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer bg-primary text-primary-foreground'
						>
							<X className='size-2.5' />
							{modelId}
						</button>
					))}
				</div>
				<div className='flex gap-2 mt-1'>
					<Input
						type='text'
						value={customModelInput}
						onChange={(e) => setCustomModelInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleAddCustomModel();
							}
						}}
						placeholder='Add custom model ID...'
						className='flex-1'
					/>
					<Button
						type='button'
						variant='outline'
						size='sm'
						onClick={handleAddCustomModel}
						disabled={!customModelInput.trim()}
					>
						<Plus className='size-4' />
					</Button>
				</div>
			</div>

			{/* Advanced settings toggle */}
			<button
				type='button'
				onClick={() => setShowAdvanced(!showAdvanced)}
				className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
			>
				<ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
				Advanced settings
			</button>

			{/* Base URL (advanced) */}
			{showAdvanced && (
				<div className='grid gap-2 pl-4 border-l-2 border-border'>
					<label htmlFor='base-url' className='text-sm font-medium text-foreground'>
						Custom Base URL <span className='text-muted-foreground font-normal'>(optional)</span>
					</label>
					<Input
						id='base-url'
						type='url'
						value={formState.baseUrl}
						onChange={(e) => setFormState((prev) => ({ ...prev, baseUrl: e.target.value }))}
						placeholder='e.g., https://your-proxy.com/v1'
					/>
					<p className='text-xs text-muted-foreground'>
						Use a custom endpoint instead of the default provider URL.
					</p>
				</div>
			)}

			{/* Error display */}
			{error && <p className='text-sm text-destructive'>{error.message}</p>}

			{/* Action buttons */}
			<div className='flex justify-end gap-2 pt-2'>
				<Button variant='ghost' size='sm' onClick={onCancel}>
					Cancel
				</Button>
				<Button size='sm' onClick={onSave} disabled={isSaveDisabled}>
					{showPlusIcon && <Plus className='size-4 mr-1' />}
					{saveButtonText}
				</Button>
			</div>
		</>
	);
}
