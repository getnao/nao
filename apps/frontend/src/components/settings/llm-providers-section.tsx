import { ProviderCard } from './llm-provider-card';
import { LlmProviderForm } from './llm-provider-form';
import type { LlmProvider } from '@nao/shared/types';
import { useLlmProviders } from '@/hooks/use-llm-providers';

interface LlmProvidersSectionProps {
	isAdmin: boolean;
}

export function LlmProvidersSection({ isAdmin }: LlmProvidersSectionProps) {
	const {
		projectConfigs,
		configProviders,
		envProviders,
		envBaseUrls,
		availableProvidersToAdd,
		unconfiguredEnvProviders,
		unconfiguredConfigProviders,
		currentModels,
		editingState,
		upsertPending,
		upsertError,
		deletePending,
		handleSubmit,
		handleCancel,
		handleEditConfig,
		handleOverrideConfigProvider,
		handleDeleteConfig,
		handleSelectProvider,
		handleConfigureEnvProvider,
		getModelDisplayName,
	} = useLlmProviders();

	const providerBadges = (provider: LlmProvider) => {
		const badges: string[] = [];
		if (envProviders.includes(provider)) {
			badges.push('ENV');
		}
		if (configProviders.some((c) => c.provider === provider)) {
			badges.push('nao_config.yaml');
		}
		return badges;
	};

	return (
		<div className='grid gap-4'>
			{/* Unconfigured env providers */}
			{unconfiguredEnvProviders.map((provider) => {
				if (editingState?.isEditing && editingState.provider === provider) {
					return (
						<LlmProviderForm
							key={`env-${provider}`}
							provider={provider}
							isEditing={true}
							inheritedKeySource='env'
							currentModels={currentModels}
							onSubmit={handleSubmit}
							onCancel={handleCancel}
							isPending={upsertPending}
							error={upsertError}
							title={`Configure ${provider}`}
						/>
					);
				}
				return (
					<ProviderCard
						key={`env-${provider}`}
						provider={provider}
						badges={['ENV']}
						envBaseUrl={envBaseUrls[provider]}
						isAdmin={isAdmin}
						isFormActive={!!editingState}
						onEdit={() => handleConfigureEnvProvider(provider)}
						getModelDisplayName={getModelDisplayName}
					/>
				);
			})}

			{/* Providers declared in nao_config.yaml */}
			{unconfiguredConfigProviders.map((configProvider) => {
				if (editingState?.isEditing && editingState.provider === configProvider.provider) {
					return (
						<LlmProviderForm
							key={`config-${configProvider.provider}`}
							provider={configProvider.provider}
							isEditing={true}
							inheritedKeySource='config'
							initialValues={editingState.initialValues}
							currentModels={currentModels}
							onSubmit={handleSubmit}
							onCancel={handleCancel}
							isPending={upsertPending}
							error={upsertError}
							title={`Override ${configProvider.provider}`}
						/>
					);
				}
				return (
					<ProviderCard
						key={`config-${configProvider.provider}`}
						provider={configProvider.provider}
						apiKeyPreview={configProvider.apiKeyPreview}
						credentialPreviews={configProvider.credentialPreviews}
						baseUrl={configProvider.baseUrl}
						enabledModels={configProvider.enabledModels}
						badges={providerBadges(configProvider.provider)}
						isAdmin={isAdmin}
						isFormActive={!!editingState}
						onEdit={() => handleOverrideConfigProvider(configProvider)}
						getModelDisplayName={getModelDisplayName}
					/>
				);
			})}

			{/* Project configs */}
			{projectConfigs.map((config) => {
				if (editingState?.isEditing && editingState.provider === config.provider) {
					return (
						<LlmProviderForm
							key={config.id}
							provider={config.provider}
							isEditing={true}
							inheritedKeySource={editingState.inheritedKeySource}
							initialValues={editingState.initialValues}
							currentModels={currentModels}
							onSubmit={handleSubmit}
							onCancel={handleCancel}
							isPending={upsertPending}
							error={upsertError}
							title={`Edit ${config.provider}`}
						/>
					);
				}
				return (
					<ProviderCard
						key={config.id}
						provider={config.provider}
						apiKeyPreview={config.apiKeyPreview}
						credentialPreviews={config.credentialPreviews}
						baseUrl={config.baseUrl}
						envBaseUrl={envBaseUrls[config.provider]}
						enabledModels={config.enabledModels}
						badges={providerBadges(config.provider)}
						isAdmin={isAdmin}
						isFormActive={!!editingState}
						onEdit={() => handleEditConfig(config)}
						onDelete={() => handleDeleteConfig(config.provider)}
						isDeleting={deletePending}
						getModelDisplayName={getModelDisplayName}
					/>
				);
			})}

			{/* Add new config form */}
			{isAdmin && !editingState?.isEditing && (availableProvidersToAdd.length > 0 || editingState) && (
				<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
					{!editingState && availableProvidersToAdd.length > 0 && (
						<div className='grid gap-2'>
							<label className='text-sm font-medium text-foreground'>Add Provider</label>
							<div className='flex flex-wrap gap-2'>
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

					{editingState && !editingState.isEditing && (
						<LlmProviderForm
							provider={editingState.provider}
							isEditing={false}
							inheritedKeySource={editingState.inheritedKeySource}
							currentModels={currentModels}
							onSubmit={handleSubmit}
							onCancel={handleCancel}
							isPending={upsertPending}
							error={upsertError}
							title={`Add ${editingState.provider}`}
							showPlusIcon
							noWrapper
						/>
					)}
				</div>
			)}

			{projectConfigs.length === 0 &&
				unconfiguredEnvProviders.length === 0 &&
				unconfiguredConfigProviders.length === 0 &&
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
