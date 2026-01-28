import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus, Trash2, X, Pencil } from 'lucide-react';
import { getDefaultModelId } from 'backend/llm';
import type { LlmProvider } from 'backend/llm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';
import { capitalize } from '@/lib/utils';

interface LlmProvidersSectionProps {
	isAdmin: boolean;
}

interface ConfigFormState {
	provider: LlmProvider | '';
	apiKey: string;
	enabledModels: string[];
	baseUrl: string;
	isEditing: boolean;
	usesEnvKey: boolean;
}

const initialFormState: ConfigFormState = {
	provider: '',
	apiKey: '',
	enabledModels: [],
	baseUrl: '',
	isEditing: false,
	usesEnvKey: false,
};

export function LlmProvidersSection({ isAdmin }: LlmProvidersSectionProps) {
	const queryClient = useQueryClient();
	const llmConfigs = useQuery(trpc.project.getLlmConfigs.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());

	const [formState, setFormState] = useState<ConfigFormState>(initialFormState);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [customModelInput, setCustomModelInput] = useState('');

	const upsertLlmConfig = useMutation(trpc.project.upsertLlmConfig.mutationOptions());
	const deleteLlmConfig = useMutation(trpc.project.deleteLlmConfig.mutationOptions());

	const projectConfigs = llmConfigs.data?.projectConfigs ?? [];
	const envProviders = llmConfigs.data?.envProviders ?? [];
	const projectConfiguredProviders = projectConfigs.map((c) => c.provider);

	// Providers that can be added (not yet configured, excluding the one being edited)
	const availableProvidersToAdd: LlmProvider[] = (['openai', 'anthropic'] as const).filter(
		(p) => !projectConfiguredProviders.includes(p),
	);

	// Env providers that don't have a project config yet
	const unconfiguredEnvProviders = envProviders.filter((p) => !projectConfiguredProviders.includes(p));

	const currentModels = formState.provider && knownModels.data ? knownModels.data[formState.provider] : [];

	const resetForm = () => {
		setFormState(initialFormState);
		setShowAdvanced(false);
		setCustomModelInput('');
	};

	const handleSaveConfig = async () => {
		if (!formState.provider) {
			return;
		}

		// For new configs (not editing), API key is required unless using env key
		if (!formState.isEditing && !formState.usesEnvKey && !formState.apiKey) {
			return;
		}

		await upsertLlmConfig.mutateAsync({
			provider: formState.provider,
			apiKey: formState.apiKey || undefined, // undefined = keep existing or use env
			enabledModels: formState.enabledModels,
			baseUrl: formState.baseUrl || undefined,
		});
		await queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey });
		await queryClient.invalidateQueries({ queryKey: trpc.project.getAvailableModels.queryOptions().queryKey });
		resetForm();
	};

	const handleEditConfig = (config: (typeof projectConfigs)[0]) => {
		const isEnvProvider = envProviders.includes(config.provider);
		setFormState({
			provider: config.provider,
			apiKey: '',
			enabledModels: config.enabledModels ?? [],
			baseUrl: config.baseUrl ?? '',
			isEditing: true,
			usesEnvKey: isEnvProvider,
		});
		setShowAdvanced(!!config.baseUrl);
	};

	const handleDeleteConfig = async (provider: LlmProvider) => {
		await deleteLlmConfig.mutateAsync({ provider });
		await queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey });
		await queryClient.invalidateQueries({ queryKey: trpc.project.getAvailableModels.queryOptions().queryKey });
	};

	const handleSelectProvider = (provider: LlmProvider) => {
		const isEnvProvider = envProviders.includes(provider);
		setFormState((prev) => ({
			...prev,
			provider,
			enabledModels: [],
			usesEnvKey: isEnvProvider,
		}));
	};

	const handleConfigureEnvProvider = (provider: LlmProvider) => {
		setFormState({
			provider,
			apiKey: '',
			enabledModels: [],
			baseUrl: '',
			isEditing: false,
			usesEnvKey: true,
		});
	};

	const toggleModel = (modelId: string) => {
		setFormState((prev) => {
			const isEnabled = prev.enabledModels.includes(modelId);
			return {
				...prev,
				enabledModels: isEnabled
					? prev.enabledModels.filter((m) => m !== modelId)
					: [...prev.enabledModels, modelId],
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

	const isCustomModel = (modelId: string) => {
		return !currentModels.some((m) => m.id === modelId);
	};

	const getModelDisplayName = (provider: LlmProvider, modelId: string) => {
		const models = knownModels.data?.[provider] ?? [];
		const model = models.find((m) => m.id === modelId);
		return model?.name ?? modelId;
	};

	// Determine if save button should be disabled
	const isSaveDisabled = (() => {
		if (upsertLlmConfig.isPending) {
			return true;
		}
		if (!formState.provider) {
			return true;
		}
		// For editing, always allow save (can change just models/baseUrl)
		if (formState.isEditing) {
			return false;
		}
		// For new configs with env key, always allow
		if (formState.usesEnvKey) {
			return false;
		}
		// For new configs without env key, require API key
		return !formState.apiKey;
	})();

	return (
		<div className='grid gap-4 pt-4 border-t border-border'>
			<h4 className='text-sm font-medium text-foreground'>LLM Providers</h4>

			{/* Environment-configured providers without project config */}
			{unconfiguredEnvProviders.map((provider) => (
				<div
					key={`env-${provider}`}
					className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'
				>
					<div className='flex-1 grid gap-1'>
						<span className='text-sm font-medium text-foreground capitalize'>{provider}</span>
						<span className='text-xs text-muted-foreground'>API key from environment</span>
					</div>
					{isAdmin && (
						<Button
							variant='outline'
							size='sm'
							onClick={() => handleConfigureEnvProvider(provider)}
							disabled={!!formState.provider}
						>
							Configure Models
						</Button>
					)}
					<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>ENV</span>
				</div>
			))}

			{/* Project-specific configs */}
			{projectConfigs.map((config) => {
				const isEditingThis = formState.isEditing && formState.provider === config.provider;

				// Show inline edit form for this config
				if (isEditingThis) {
					return (
						<div
							key={config.id}
							className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'
						>
							{/* Form header */}
							<div className='flex items-center justify-between'>
								<span className='text-sm font-medium text-foreground capitalize'>
									Edit {formState.provider}
									{formState.usesEnvKey && (
										<span className='text-muted-foreground font-normal ml-1'>
											(using env API key)
										</span>
									)}
								</span>
								<Button variant='ghost' size='icon-sm' onClick={resetForm}>
									<X className='size-4' />
								</Button>
							</div>

							{/* API Key field */}
							<div className='grid gap-2'>
								<label htmlFor='edit-api-key' className='text-sm font-medium text-foreground'>
									API Key
									{!formState.usesEnvKey && (
										<span className='text-muted-foreground font-normal ml-1'>
											(leave empty to keep current)
										</span>
									)}
									{formState.usesEnvKey && (
										<span className='text-muted-foreground font-normal ml-1'>
											(leave empty to keep current or use env)
										</span>
									)}
								</label>
								<Input
									id='edit-api-key'
									type='password'
									value={formState.apiKey}
									onChange={(e) => setFormState((prev) => ({ ...prev, apiKey: e.target.value }))}
									placeholder='Enter new API key to update'
								/>
							</div>

							{/* Model selection */}
							{/* Model selection */}
							<div className='grid gap-2'>
								<label className='text-sm font-medium text-foreground'>
									Enabled Models
									<span className='text-muted-foreground font-normal ml-1'>
										(leave empty for default {getDefaultModelId(config.provider)})
									</span>
								</label>
								<div className='flex flex-wrap gap-2'>
									{currentModels.map((model) => {
										const isEnabled = formState.enabledModels.includes(model.id);
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
									{/* Custom models (not in known models list) */}
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
								{/* Custom model input */}
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
								<ChevronDown
									className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
								/>
								Advanced settings
							</button>

							{/* Base URL (advanced) */}
							{showAdvanced && (
								<div className='grid gap-2 pl-4 border-l-2 border-border'>
									<label htmlFor='edit-base-url' className='text-sm font-medium text-foreground'>
										Custom Base URL{' '}
										<span className='text-muted-foreground font-normal'>(optional)</span>
									</label>
									<Input
										id='edit-base-url'
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

							{/* Action buttons */}
							<div className='flex justify-end gap-2 pt-2'>
								<Button variant='ghost' size='sm' onClick={resetForm}>
									Cancel
								</Button>
								<Button size='sm' onClick={handleSaveConfig} disabled={isSaveDisabled}>
									Save Changes
								</Button>
							</div>
						</div>
					);
				}

				// Normal config display
				return (
					<div key={config.id} className='p-4 rounded-lg border border-border bg-muted/30'>
						<div className='flex items-center gap-4'>
							<div className='flex-1 grid gap-1'>
								<div className='flex items-center gap-2'>
									<span className='text-sm font-medium text-foreground capitalize'>
										{config.provider}
									</span>
									{envProviders.includes(config.provider) && (
										<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>
											ENV
										</span>
									)}
								</div>
								<div className='flex items-center gap-2 text-xs text-muted-foreground'>
									<span className='font-mono'>{config.apiKeyPreview}</span>
									{config.baseUrl && (
										<>
											<span className='text-border'>•</span>
											<span className='truncate max-w-[150px]' title={config.baseUrl}>
												Custom URL
											</span>
										</>
									)}
								</div>
							</div>
							{isAdmin && (
								<div className='flex items-center gap-1'>
									<Button
										variant='ghost'
										size='icon-sm'
										onClick={() => handleEditConfig(config)}
										disabled={!!formState.provider}
									>
										<Pencil className='size-3 text-muted-foreground' />
									</Button>
									<Button
										variant='ghost'
										size='icon-sm'
										onClick={() => handleDeleteConfig(config.provider)}
										disabled={deleteLlmConfig.isPending || !!formState.provider}
									>
										<Trash2 className='size-4 text-destructive' />
									</Button>
								</div>
							)}
						</div>
						{/* Enabled models */}
						{config.enabledModels.length > 0 && (
							<div className='mt-3 pt-3 border-t border-border/50'>
								<span className='text-xs text-muted-foreground'>Enabled models:</span>
								<div className='flex flex-wrap gap-1.5 mt-1.5'>
									{config.enabledModels.map((modelId) => (
										<span
											key={modelId}
											className='px-2 py-0.5 text-xs rounded bg-primary/10 text-primary'
										>
											{getModelDisplayName(config.provider, modelId)}
										</span>
									))}
								</div>
							</div>
						)}
						{config.enabledModels.length === 0 && (
							<div className='mt-3 pt-3 border-t border-border/50'>
								<span className='text-xs text-muted-foreground'>
									Default model: {getDefaultModelId(config.provider)}
								</span>
							</div>
						)}
					</div>
				);
			})}

			{/* Add new config form (admin only) - only show when not editing */}
			{isAdmin &&
				!formState.isEditing &&
				(availableProvidersToAdd.length > 0 || (formState.provider && !formState.isEditing)) && (
					<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
						{/* Provider selection - only for adding new (non-env) providers */}
						{!formState.usesEnvKey && !formState.provider && availableProvidersToAdd.length > 0 && (
							<div className='grid gap-2'>
								<label className='text-sm font-medium text-foreground'>Add Provider</label>
								<div className='flex gap-2'>
									{availableProvidersToAdd.map((provider) => (
										<button
											key={provider}
											type='button'
											onClick={() => handleSelectProvider(provider)}
											className='px-4 py-2 rounded-md text-sm font-medium transition-all capitalize cursor-pointer bg-secondary text-muted-foreground hover:text-foreground'
										>
											{provider}
										</button>
									))}
								</div>
							</div>
						)}

						{/* Form header when provider is selected */}
						{formState.provider && (
							<div className='flex items-center justify-between'>
								<span className='text-sm font-medium text-foreground capitalize'>
									{formState.usesEnvKey ? 'Configure' : 'Add'} {formState.provider}
									{formState.usesEnvKey && (
										<span className='text-muted-foreground font-normal ml-1'>
											(using env API key)
										</span>
									)}
								</span>
								<Button variant='ghost' size='icon-sm' onClick={resetForm}>
									<X className='size-4' />
								</Button>
							</div>
						)}

						{formState.provider && (
							<>
								{/* API Key field - always show, with appropriate hint text */}
								<div className='grid gap-2'>
									<label htmlFor='new-api-key' className='text-sm font-medium text-foreground'>
										API Key
										{formState.usesEnvKey && (
											<span className='text-muted-foreground font-normal ml-1'>
												(optional - leave empty to use env)
											</span>
										)}
									</label>
									<Input
										id='new-api-key'
										type='password'
										value={formState.apiKey}
										onChange={(e) => setFormState((prev) => ({ ...prev, apiKey: e.target.value }))}
										placeholder={
											formState.usesEnvKey
												? 'Enter API key to override env variable'
												: `Enter your ${capitalize(formState.provider)} API key`
										}
									/>
								</div>

								{/* Model selection */}
								<div className='grid gap-2'>
									<label className='text-sm font-medium text-foreground'>
										Enabled Models
										<span className='text-muted-foreground font-normal ml-1'>
											(leave empty for default {getDefaultModelId(formState.provider)})
										</span>
									</label>
									<div className='flex flex-wrap gap-2'>
										{currentModels.map((model) => {
											const isEnabled = formState.enabledModels.includes(model.id);
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
										{/* Custom models (not in known models list) */}
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
									{/* Custom model input */}
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
									<ChevronDown
										className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
									/>
									Advanced settings
								</button>

								{/* Base URL (advanced) */}
								{showAdvanced && (
									<div className='grid gap-2 pl-4 border-l-2 border-border'>
										<label htmlFor='base-url' className='text-sm font-medium text-foreground'>
											Custom Base URL{' '}
											<span className='text-muted-foreground font-normal'>(optional)</span>
										</label>
										<Input
											id='base-url'
											type='url'
											value={formState.baseUrl}
											onChange={(e) =>
												setFormState((prev) => ({ ...prev, baseUrl: e.target.value }))
											}
											placeholder='e.g., https://your-proxy.com/v1'
										/>
										<p className='text-xs text-muted-foreground'>
											Use a custom endpoint instead of the default provider URL.
										</p>
									</div>
								)}

								{/* Action buttons */}
								<div className='flex justify-end gap-2 pt-2'>
									<Button variant='ghost' size='sm' onClick={resetForm}>
										Cancel
									</Button>
									<Button size='sm' onClick={handleSaveConfig} disabled={isSaveDisabled}>
										<Plus className='size-4 mr-1' />
										Save
									</Button>
								</div>
							</>
						)}
					</div>
				)}

			{projectConfigs.length === 0 &&
				unconfiguredEnvProviders.length === 0 &&
				availableProvidersToAdd.length === 0 && (
					<p className='text-sm text-muted-foreground'>
						{isAdmin
							? 'No providers configured. Add an API key above.'
							: 'No providers configured. Contact an admin to set up LLM providers.'}
					</p>
				)}
		</div>
	);
}
