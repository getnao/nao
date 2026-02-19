import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { capitalize } from '@/lib/utils';
import { trpc } from '@/main';

interface SettingsTranscribeProps {
	isAdmin: boolean;
}

export function SettingsTranscribe({ isAdmin }: SettingsTranscribeProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownTranscribeModels.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const providers = Object.keys(knownModels.data ?? {});
	const isEnabled = agentSettings.data?.transcribe?.enabled ?? false;
	const currentProvider = agentSettings.data?.transcribe?.provider ?? providers[0] ?? 'openai';
	const providerModels = knownModels.data?.[currentProvider as keyof typeof knownModels.data] ?? [];
	const currentModelId = agentSettings.data?.transcribe?.modelId ?? providerModels.find((m) => m.default)?.id ?? '';

	const handleToggle = (enabled: boolean) => {
		updateAgentSettings.mutate({
			transcribe: { enabled },
		});
	};

	const handleProviderChange = (provider: string) => {
		const models = knownModels.data?.[provider as keyof typeof knownModels.data] ?? [];
		const defaultModelId = models.find((m) => m.default)?.id ?? models[0]?.id ?? '';
		updateAgentSettings.mutate({
			transcribe: { provider, modelId: defaultModelId },
		});
	};

	const handleModelChange = (modelId: string) => {
		updateAgentSettings.mutate({
			transcribe: { provider: currentProvider, modelId },
		});
	};

	const isMutating = updateAgentSettings.isPending;

	return (
		<SettingsCard
			title='Transcription'
			action={<Switch checked={isEnabled} onCheckedChange={handleToggle} disabled={!isAdmin} />}
		>
			{isEnabled && (
				<div className='space-y-4'>
					<p className='text-sm text-muted-foreground'>
						Configure the speech-to-text provider and model used for voice input in the chat.
					</p>

					<div className='grid gap-2'>
						<label className='text-sm font-medium text-foreground'>Provider</label>
						<Select
							value={currentProvider}
							onValueChange={handleProviderChange}
							disabled={!isAdmin || isMutating || providers.length <= 1}
						>
							<SelectTrigger className='w-full'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{providers.map((provider) => (
									<SelectItem key={provider} value={provider}>
										{capitalize(provider)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className='grid gap-2'>
						<label className='text-sm font-medium text-foreground'>Model</label>
						<Select
							value={currentModelId}
							onValueChange={handleModelChange}
							disabled={!isAdmin || isMutating || providerModels.length === 0}
						>
							<SelectTrigger className='w-full'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{providerModels.map((model) => (
									<SelectItem key={model.id} value={model.id}>
										{model.name}
										{model.pricePerMinute != null && (
											<span className='text-muted-foreground'>${model.pricePerMinute}/min</span>
										)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			)}
		</SettingsCard>
	);
}
