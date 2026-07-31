import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { llmProviderSchema } from '@nao/backend/llm';
import type { CustomModelMetadata, ModelSettingsMap } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';
import type { InheritedKeySource } from '@/components/settings/llm-provider-form';
import { trpc } from '@/main';

export interface EditingState {
	provider: LlmProvider;
	isEditing: boolean;
	inheritedKeySource: InheritedKeySource | null;
	initialValues?: {
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		modelSettings: ModelSettingsMap;
		baseUrl: string;
	};
}

export function useLlmProviders() {
	const queryClient = useQueryClient();

	// Queries
	const llmConfigs = useQuery(trpc.project.getLlmConfigs.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());

	// Mutations
	const upsertLlmConfig = useMutation(trpc.project.upsertLlmConfig.mutationOptions());
	const deleteLlmConfig = useMutation(trpc.project.deleteLlmConfig.mutationOptions());

	// Local state
	const [editingState, setEditingState] = useState<EditingState | null>(null);

	// Derived data
	const projectConfigs = llmConfigs.data?.projectConfigs ?? [];
	const configProviders = llmConfigs.data?.configProviders ?? [];
	const envProviders = llmConfigs.data?.envProviders ?? [];
	const envBaseUrls = llmConfigs.data?.envBaseUrls ?? {};
	const projectConfiguredProviders = projectConfigs.map((c) => c.provider);

	const availableProvidersToAdd: LlmProvider[] = llmProviderSchema.options.filter(
		(p) =>
			!projectConfiguredProviders.includes(p) &&
			!envProviders.includes(p) &&
			!configProviders.some((c) => c.provider === p),
	);

	const unconfiguredEnvProviders = envProviders.filter((p) => !projectConfiguredProviders.includes(p));

	const unconfiguredConfigProviders = configProviders.filter((c) => !projectConfiguredProviders.includes(c.provider));

	const currentModels = editingState?.provider && knownModels.data ? knownModels.data[editingState.provider] : [];

	const resolveInheritedKeySource = (provider: LlmProvider): InheritedKeySource | null => {
		if (configProviders.some((c) => c.provider === provider)) {
			return 'config';
		}
		if (envProviders.includes(provider)) {
			return 'env';
		}
		return null;
	};

	// Handlers
	const invalidateQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey }),
			queryClient.invalidateQueries({
				queryKey: trpc.project.listAvailableTranscribeModels.queryOptions().queryKey,
			}),
			queryClient.invalidateQueries({ queryKey: trpc.project.getKnownTranscribeModels.queryOptions().queryKey }),
		]);
	};

	const handleSubmit = async (values: {
		apiKey?: string;
		credentials?: Record<string, string>;
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		modelSettings: ModelSettingsMap;
		baseUrl?: string;
	}) => {
		if (!editingState?.provider) {
			return;
		}

		await upsertLlmConfig.mutateAsync({
			provider: editingState.provider,
			apiKey: values.apiKey,
			credentials: values.credentials,
			enabledModels: values.enabledModels,
			customModels: values.customModels,
			modelSettings: values.modelSettings,
			baseUrl: values.baseUrl,
		});
		await invalidateQueries();
		setEditingState(null);
		upsertLlmConfig.reset();
	};

	const handleCancel = () => {
		setEditingState(null);
		upsertLlmConfig.reset();
	};

	const handleEditConfig = (config: (typeof projectConfigs)[0]) => {
		setEditingState({
			provider: config.provider,
			isEditing: true,
			inheritedKeySource: resolveInheritedKeySource(config.provider),
			initialValues: {
				enabledModels: config.enabledModels ?? [],
				customModels: config.customModels ?? [],
				modelSettings: config.modelSettings ?? {},
				baseUrl: config.baseUrl ?? '',
			},
		});
	};

	/** Seed the form with the nao_config.yaml values so saving creates an override of them. */
	const handleOverrideConfigProvider = (configProvider: (typeof configProviders)[0]) => {
		setEditingState({
			provider: configProvider.provider,
			isEditing: true,
			inheritedKeySource: 'config',
			initialValues: {
				enabledModels: configProvider.enabledModels,
				customModels: configProvider.customModels,
				modelSettings: configProvider.modelSettings,
				baseUrl: configProvider.baseUrl ?? '',
			},
		});
	};

	const handleDeleteConfig = async (provider: LlmProvider) => {
		await deleteLlmConfig.mutateAsync({ provider });
		await invalidateQueries();
	};

	const handleSelectProvider = (provider: LlmProvider) => {
		setEditingState({
			provider,
			isEditing: false,
			inheritedKeySource: resolveInheritedKeySource(provider),
		});
	};

	const handleConfigureEnvProvider = (provider: LlmProvider) => {
		setEditingState({
			provider,
			isEditing: true,
			inheritedKeySource: 'env',
		});
	};

	const getModelDisplayName = (provider: LlmProvider, modelId: string) => {
		const models = knownModels.data?.[provider] ?? [];
		const knownName = models.find((m) => m.id === modelId)?.name;
		if (knownName) {
			return knownName;
		}
		const customModel = findCustomModel(provider, modelId);
		return customModel?.displayName?.trim() || modelId;
	};

	const findCustomModel = (provider: LlmProvider, modelId: string) => {
		const fromProjectConfig = projectConfigs
			.find((c) => c.provider === provider)
			?.customModels?.find((m) => m.id === modelId);
		if (fromProjectConfig) {
			return fromProjectConfig;
		}
		return configProviders.find((c) => c.provider === provider)?.customModels.find((m) => m.id === modelId);
	};

	return {
		// Data
		projectConfigs,
		configProviders,
		envProviders,
		envBaseUrls,
		availableProvidersToAdd,
		unconfiguredEnvProviders,
		unconfiguredConfigProviders,
		currentModels,

		// State
		editingState,

		// Mutation state
		upsertPending: upsertLlmConfig.isPending,
		upsertError: upsertLlmConfig.error,
		deletePending: deleteLlmConfig.isPending,

		// Handlers
		handleSubmit,
		handleCancel,
		handleEditConfig,
		handleOverrideConfigProvider,
		handleDeleteConfig,
		handleSelectProvider,
		handleConfigureEnvProvider,
		getModelDisplayName,
	};
}
