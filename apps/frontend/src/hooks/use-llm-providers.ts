import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVIDER_META } from '@nao/backend/provider-meta';
import {
	LLM_PROVIDERS,
	NAMED_PROVIDER_KIND,
	providerKind,
	providerName,
	toNamedProvider,
	toProviderName,
} from '@nao/shared/types';
import type { CustomModelMetadata, ModelSettingsMap } from '@nao/backend/llm';
import type { LlmProvider, LlmProviderKind } from '@nao/shared/types';
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

	// Kinds that accept several instances stay on offer: each new one is added under its own name.
	const availableProvidersToAdd: LlmProviderKind[] = LLM_PROVIDERS.filter(
		(p) =>
			p === NAMED_PROVIDER_KIND ||
			(!projectConfiguredProviders.includes(p) &&
				!envProviders.includes(p) &&
				!configProviders.some((c) => c.provider === p)),
	);

	// Names already in use, so that adding an endpoint cannot silently overwrite one of them.
	const takenProviderNames = [...projectConfiguredProviders, ...configProviders.map((c) => c.provider)]
		.map(providerName)
		.filter((name): name is string => name !== null);

	const unconfiguredEnvProviders = envProviders.filter((p) => !projectConfiguredProviders.includes(p));

	const unconfiguredConfigProviders = configProviders.filter((c) => !projectConfiguredProviders.includes(c.provider));

	const currentModels =
		editingState?.provider && knownModels.data ? knownModels.data[providerKind(editingState.provider)] : [];

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
			queryClient.invalidateQueries({ queryKey: trpc.project.getDefaultModels.queryOptions().queryKey }),
		]);
	};

	const handleSubmit = async (values: {
		apiKey?: string;
		credentials?: Record<string, string>;
		name?: string;
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		modelSettings: ModelSettingsMap;
		baseUrl?: string;
	}) => {
		if (!editingState?.provider) {
			return;
		}

		const provider = resolveSubmittedProvider(editingState.provider, values.name);
		const name = providerName(provider);
		if (!editingState.isEditing && name && takenProviderNames.includes(name)) {
			throw new Error(`An endpoint named '${name}' already exists`);
		}

		await upsertLlmConfig.mutateAsync({
			provider,
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
		// Adding a provider of the named kind creates an endpoint of its own, with credentials of its own.
		const inheritsCredentials = providerKind(provider) !== NAMED_PROVIDER_KIND;
		setEditingState({
			provider,
			isEditing: false,
			inheritedKeySource: inheritsCredentials ? resolveInheritedKeySource(provider) : null,
		});
	};

	const handleConfigureEnvProvider = (provider: LlmProvider) => {
		// Endpoints nao cannot guess start from the environment value rather than an empty field.
		const baseUrl = PROVIDER_META[providerKind(provider)].requiresBaseUrl ? (envBaseUrls[provider] ?? '') : '';
		setEditingState({
			provider,
			isEditing: true,
			inheritedKeySource: 'env',
			initialValues: { enabledModels: [], customModels: [], modelSettings: {}, baseUrl },
		});
	};

	const getModelDisplayName = (provider: LlmProvider, modelId: string) => {
		const models = knownModels.data?.[providerKind(provider)] ?? [];
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
		takenProviderNames,
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

/** A provider the admin named is saved under that name, so the project can hold several of its kind. */
function resolveSubmittedProvider(provider: LlmProvider, name?: string): LlmProvider {
	const instanceName = name ? toProviderName(name) : null;
	return instanceName ? toNamedProvider(instanceName) : provider;
}
