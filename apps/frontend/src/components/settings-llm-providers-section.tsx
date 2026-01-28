import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { llmProviderSchema } from 'backend/llm';
import { ConfigFormFields, initialFormState } from './settings-llm-config-form-fields';
import { ProviderCard } from './settings-llm-provider-card';
import type { LlmProvider } from 'backend/llm';
import type { ConfigFormState } from './settings-llm-config-form-fields';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { capitalize } from '@/lib/utils';

interface LlmProvidersSectionProps {
	isAdmin: boolean;
}

interface EditFormProps {
	title: string;
	showPlusIcon?: boolean;
	noWrapper?: boolean;
	formState: ConfigFormState;
	setFormState: React.Dispatch<React.SetStateAction<ConfigFormState>>;
	currentModels: readonly { id: string; name: string; default?: boolean }[];
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
}

function EditForm({
	title,
	showPlusIcon,
	noWrapper,
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
}: EditFormProps) {
	const content = (
		<>
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-foreground capitalize'>
					{title}
					{formState.usesEnvKey && (
						<span className='text-muted-foreground font-normal ml-1'>(using env API key)</span>
					)}
				</span>
				<Button variant='ghost' size='icon-sm' onClick={onCancel}>
					<X className='size-4' />
				</Button>
			</div>
			<ConfigFormFields
				formState={formState}
				setFormState={setFormState}
				currentModels={currentModels}
				customModelInput={customModelInput}
				setCustomModelInput={setCustomModelInput}
				showAdvanced={showAdvanced}
				setShowAdvanced={setShowAdvanced}
				error={error}
				isSaveDisabled={isSaveDisabled}
				onSave={onSave}
				onCancel={onCancel}
				apiKeyHint={apiKeyHint}
				apiKeyPlaceholder={apiKeyPlaceholder}
				saveButtonText={formState.isEditing ? 'Save Changes' : 'Save'}
				showPlusIcon={showPlusIcon}
			/>
		</>
	);

	if (noWrapper) {
		return content;
	}

	return <div className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'>{content}</div>;
}

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

	const availableProvidersToAdd: LlmProvider[] = llmProviderSchema.options.filter(
		(p) => !projectConfiguredProviders.includes(p) && !envProviders.includes(p),
	);

	const unconfiguredEnvProviders = envProviders.filter((p) => !projectConfiguredProviders.includes(p));
	const currentModels = formState.provider && knownModels.data ? knownModels.data[formState.provider] : [];

	const resetForm = () => {
		setFormState(initialFormState);
		setShowAdvanced(false);
		setCustomModelInput('');
		upsertLlmConfig.reset();
	};

	const invalidateQueries = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey });
		await queryClient.invalidateQueries({ queryKey: trpc.project.getAvailableModels.queryOptions().queryKey });
	};

	const handleSaveConfig = async () => {
		if (!formState.provider) {
			return;
		}
		if (!formState.isEditing && !formState.usesEnvKey && !formState.apiKey) {
			return;
		}

		try {
			await upsertLlmConfig.mutateAsync({
				provider: formState.provider,
				apiKey: formState.apiKey || undefined,
				enabledModels: formState.enabledModels,
				baseUrl: formState.baseUrl || undefined,
			});
			await invalidateQueries();
			resetForm();
		} catch {
			// Error is captured by mutation state
		}
	};

	const handleEditConfig = (config: (typeof projectConfigs)[0]) => {
		setFormState({
			provider: config.provider,
			apiKey: '',
			enabledModels: config.enabledModels ?? [],
			baseUrl: config.baseUrl ?? '',
			isEditing: true,
			usesEnvKey: envProviders.includes(config.provider),
		});
		setShowAdvanced(!!config.baseUrl);
	};

	const handleDeleteConfig = async (provider: LlmProvider) => {
		await deleteLlmConfig.mutateAsync({ provider });
		await invalidateQueries();
	};

	const handleSelectProvider = (provider: LlmProvider) => {
		setFormState((prev) => ({
			...prev,
			provider,
			enabledModels: [],
			usesEnvKey: envProviders.includes(provider),
		}));
	};

	const handleConfigureEnvProvider = (provider: LlmProvider) => {
		setFormState({
			provider,
			apiKey: '',
			enabledModels: [],
			baseUrl: '',
			isEditing: true,
			usesEnvKey: true,
		});
	};

	const getModelDisplayName = (provider: LlmProvider, modelId: string) => {
		const models = knownModels.data?.[provider] ?? [];
		return models.find((m) => m.id === modelId)?.name ?? modelId;
	};

	const isSaveDisabled =
		upsertLlmConfig.isPending ||
		!formState.provider ||
		(!formState.isEditing && !formState.usesEnvKey && !formState.apiKey);

	const getApiKeyHint = () => {
		if (formState.usesEnvKey) {
			return '(optional - leave empty to use env)';
		}
		if (formState.isEditing) {
			return '(leave empty to keep current)';
		}
		return '';
	};

	const getApiKeyPlaceholder = () => {
		if (formState.usesEnvKey) {
			return 'Enter API key to override env variable';
		}
		if (formState.isEditing) {
			return 'Enter new API key to update';
		}
		return `Enter your ${formState.provider ? capitalize(formState.provider) : ''} API key`;
	};

	const editFormProps = {
		formState,
		setFormState,
		currentModels,
		customModelInput,
		setCustomModelInput,
		showAdvanced,
		setShowAdvanced,
		error: upsertLlmConfig.error,
		isSaveDisabled,
		onSave: handleSaveConfig,
		onCancel: resetForm,
		apiKeyHint: getApiKeyHint(),
		apiKeyPlaceholder: getApiKeyPlaceholder(),
	};

	return (
		<div className='grid gap-4 pt-4 border-t border-border'>
			<h4 className='text-sm font-medium text-foreground'>LLM Providers</h4>

			{/* Unconfigured env providers */}
			{unconfiguredEnvProviders.map((provider) => {
				if (formState.isEditing && formState.provider === provider) {
					return <EditForm key={`env-${provider}`} title={`Configure ${provider}`} {...editFormProps} />;
				}
				return (
					<ProviderCard
						key={`env-${provider}`}
						provider={provider}
						isEnvProvider
						isAdmin={isAdmin}
						isFormActive={!!formState.provider}
						onEdit={() => handleConfigureEnvProvider(provider)}
						getModelDisplayName={getModelDisplayName}
					/>
				);
			})}

			{/* Project configs */}
			{projectConfigs.map((config) => {
				if (formState.isEditing && formState.provider === config.provider) {
					return <EditForm key={config.id} title={`Edit ${config.provider}`} {...editFormProps} />;
				}
				return (
					<ProviderCard
						key={config.id}
						provider={config.provider}
						apiKeyPreview={config.apiKeyPreview}
						baseUrl={config.baseUrl}
						enabledModels={config.enabledModels}
						isEnvProvider={envProviders.includes(config.provider)}
						isAdmin={isAdmin}
						isFormActive={!!formState.provider}
						onEdit={() => handleEditConfig(config)}
						onDelete={() => handleDeleteConfig(config.provider)}
						isDeleting={deleteLlmConfig.isPending}
						getModelDisplayName={getModelDisplayName}
					/>
				);
			})}

			{/* Add new config form */}
			{isAdmin && !formState.isEditing && (availableProvidersToAdd.length > 0 || formState.provider) && (
				<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
					{!formState.provider && availableProvidersToAdd.length > 0 && (
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

					{formState.provider && (
						<EditForm title={`Add ${formState.provider}`} showPlusIcon noWrapper {...editFormProps} />
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
