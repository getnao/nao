import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { llmProviderSchema } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/backend/llm';
import { trpc } from '@/main';

export interface EditingState {
	provider: LlmProvider;
	isEditing: boolean;
	usesEnvKey: boolean;
	initialValues?: {
		enabledModels: string[];
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
	const envProviders = llmConfigs.data?.envProviders ?? [];
	const projectConfiguredProviders = projectConfigs.map((c) => c.provider);

	const availableProvidersToAdd: LlmProvider[] = llmProviderSchema.options.filter(
		(p) => !projectConfiguredProviders.includes(p) && !envProviders.includes(p),
	);

	const unconfiguredEnvProviders = envProviders.filter((p) => !projectConfiguredProviders.includes(p));

	const currentModels = editingState?.provider && knownModels.data ? knownModels.data[editingState.provider] : [];

	// Handlers
	const invalidateQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getAvailableModels.queryOptions().queryKey }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getKnownTranscribeModels.queryOptions().queryKey }),
		]);
	};

	const handleSubmit = async (values: { apiKey?: string; enabledModels: string[]; baseUrl?: string }) => {
		if (!editingState?.provider) {
			return;
		}

		await upsertLlmConfig.mutateAsync({
			provider: editingState.provider,
			apiKey: values.apiKey,
			enabledModels: values.enabledModels,
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
			usesEnvKey: envProviders.includes(config.provider),
			initialValues: {
				enabledModels: config.enabledModels ?? [],
				baseUrl: config.baseUrl ?? '',
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
			usesEnvKey: envProviders.includes(provider),
		});
	};

	const handleConfigureEnvProvider = (provider: LlmProvider) => {
		setEditingState({
			provider,
			isEditing: true,
			usesEnvKey: true,
		});
	};

	const getModelDisplayName = (provider: LlmProvider, modelId: string) => {
		const models = knownModels.data?.[provider] ?? [];
		return models.find((m) => m.id === modelId)?.name ?? modelId;
	};

	return {
		// Data
		projectConfigs,
		envProviders,
		availableProvidersToAdd,
		unconfiguredEnvProviders,
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
		handleDeleteConfig,
		handleSelectProvider,
		handleConfigureEnvProvider,
		getModelDisplayName,
	};
}
