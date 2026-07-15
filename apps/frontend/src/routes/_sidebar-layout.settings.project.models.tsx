import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LlmProvidersSection } from '@/components/settings/llm-providers-section';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsTranscribe } from '@/components/settings/settings-transcribe';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';
import type { LlmProvider } from '@nao/shared/types';
import { LLM_PROVIDERS } from '@nao/shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_sidebar-layout/settings/project/models')({
	component: ProjectModelsTabPage,
});

function ProjectModelsTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<SettingsCard
				title='LLM Configuration'
				description='Configure the LLM providers for the agent in this project.'
			>
				<LlmProvidersSection isAdmin={isAdmin} />
			</SettingsCard>
			{isAdmin && <LlmAdminSettings />}
			<SettingsTranscribe isAdmin={isAdmin} />
		</>
	);
}

function LlmAdminSettings() {
	const queryClient = useQueryClient();
	const allProviders = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const llmSettings = useQuery(trpc.project.getLlmSettings.queryOptions());
	const updateLlmSettings = useMutation(
		trpc.project.updateLlmSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getLlmSettings.queryOptions().queryKey,
				});
				queryClient.invalidateQueries({
					queryKey: trpc.project.listAvailableTranscribeModels.queryOptions().queryKey,
				});
			},
		}),
	);

	const disabledProviders = llmSettings.data?.disabledProviders ?? [];
	const defaultModel = llmSettings.data?.defaultModel;
	const availableModels = allProviders.data ?? [];
	const isMutating = updateLlmSettings.isPending;

	const toggleProvider = (provider: LlmProvider) => {
		const next = disabledProviders.includes(provider)
			? disabledProviders.filter((p) => p !== provider)
			: [...disabledProviders, provider];
		updateLlmSettings.mutate({
			disabledProviders: next,
			defaultModel,
		});
	};

	const setDefaultModel = (value: string) => {
		const colonIdx = value.indexOf(':');
		if (colonIdx === -1) return;
		const provider = value.slice(0, colonIdx) as LlmProvider;
		const modelId = value.slice(colonIdx + 1);
		updateLlmSettings.mutate({
			disabledProviders,
			defaultModel: { provider, modelId },
		});
	};

	const clearDefaultModel = () => {
		updateLlmSettings.mutate({
			disabledProviders,
			defaultModel: undefined,
		});
	};

	return (
		<SettingsCard
			title='Admin Model Settings'
			description='Control which LLM providers users can see and which model is selected by default.'
		>
			<div className='space-y-5'>
				<div className='space-y-3'>
					<label className='text-sm font-medium text-foreground'>Disabled Providers</label>
					<p className='text-xs text-muted-foreground'>
						Disabled providers will not appear in the model selector for non-admin users.
					</p>
					<div className='flex flex-wrap gap-2'>
						{LLM_PROVIDERS.map((provider) => {
							const isDisabled = disabledProviders.includes(provider);
							return (
								<Badge
									key={provider}
									variant={isDisabled ? 'destructive' : 'outline'}
									className='cursor-pointer select-none capitalize text-sm px-3 py-1.5'
									onClick={() => toggleProvider(provider)}
								>
									{provider}
								</Badge>
							);
						})}
					</div>
				</div>

				<div className='space-y-3'>
					<label className='text-sm font-medium text-foreground'>Default Model</label>
					<p className='text-xs text-muted-foreground'>
						New users will see this model selected by default. When unset, the first available model is used.
					</p>
					<div className='flex items-center gap-2'>
						<Select
							value={defaultModel ? `${defaultModel.provider}:${defaultModel.modelId}` : undefined}
							onValueChange={setDefaultModel}
							disabled={isMutating || availableModels.length === 0}
						>
							<SelectTrigger className='w-full max-w-xs'>
								<SelectValue placeholder='Select default model (optional)' />
							</SelectTrigger>
							<SelectContent>
								{availableModels.map((model) => (
									<SelectItem
										key={`${model.provider}-${model.modelId}`}
										value={`${model.provider}:${model.modelId}`}
									>
										{model.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{defaultModel && (
							<Button
								variant='ghost'
								size='sm'
								onClick={clearDefaultModel}
								disabled={isMutating}
							>
								Clear
							</Button>
						)}
					</div>
				</div>
			</div>
		</SettingsCard>
	);
}
