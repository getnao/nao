import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface HarnessSettingsProps {
	isAdmin: boolean;
}

const HARNESS_PROVIDER_MAP: Record<string, string> = {
	anthropic: 'anthropic',
	openai: 'openai',
};

export function HarnessSettings({ isAdmin }: HarnessSettingsProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const harnesses = agentSettings.data?.availableHarnesses ?? [];
	const currentHarness = agentSettings.data?.harness ?? 'default';

	const handleHarnessChange = (harnessId: string) => {
		if (!isAdmin || updateAgentSettings.isPending) {
			return;
		}
		updateAgentSettings.mutate({ harness: harnessId as 'default' | 'anthropic' | 'openai' });
	};

	return (
		<SettingsCard
			title='AI model integration'
			description='Choose which AI provider powers the analytics agent. This overrides per-message model selection.'
		>
			<div className='grid gap-3'>
				{harnesses.map((harness) => {
					const isSelected = currentHarness === harness.id;
					const provider = HARNESS_PROVIDER_MAP[harness.id];

					return (
						<button
							key={harness.id}
							type='button'
							disabled={!isAdmin || updateAgentSettings.isPending}
							onClick={() => handleHarnessChange(harness.id)}
							className={cn(
								'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
								isSelected
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-primary/40 hover:bg-muted/50',
								(!isAdmin || updateAgentSettings.isPending) && 'opacity-50 cursor-not-allowed',
							)}
						>
							<div className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background'>
								{provider ? (
									<LlmProviderIcon provider={provider} className='size-5' />
								) : (
									<span className='text-xs font-medium text-muted-foreground'>AI</span>
								)}
							</div>
							<div className='flex flex-col gap-0.5'>
								<div className='flex items-center gap-2'>
									<span className='text-sm font-medium text-foreground'>{harness.label}</span>
									{isSelected && (
										<span className='rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'>
											Active
										</span>
									)}
								</div>
								<span className='text-xs text-muted-foreground'>{harness.description}</span>
							</div>
						</button>
					);
				})}
			</div>
		</SettingsCard>
	);
}
