import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';
import { capitalize } from '@/lib/utils';

type LlmProvider = 'openai' | 'anthropic';

interface LlmProvidersSectionProps {
	isAdmin: boolean;
}

export function LlmProvidersSection({ isAdmin }: LlmProvidersSectionProps) {
	const queryClient = useQueryClient();
	const llmConfigs = useQuery(trpc.project.getLlmConfigs.queryOptions());

	const [newProvider, setNewProvider] = useState<LlmProvider | ''>('');
	const [newApiKey, setNewApiKey] = useState('');

	const upsertLlmConfig = useMutation(trpc.project.upsertLlmConfig.mutationOptions());
	const deleteLlmConfig = useMutation(trpc.project.deleteLlmConfig.mutationOptions());

	const projectConfigs = llmConfigs.data?.projectConfigs ?? [];
	const envProviders = llmConfigs.data?.envProviders ?? [];
	const projectConfiguredProviders = projectConfigs.map((c) => c.provider);
	const availableProviders: LlmProvider[] = (['openai', 'anthropic'] as const).filter(
		(p) => !projectConfiguredProviders.includes(p),
	);

	const handleAddConfig = async () => {
		if (!newProvider || !newApiKey) {
			return;
		}
		await upsertLlmConfig.mutateAsync({ provider: newProvider, apiKey: newApiKey });
		queryClient.invalidateQueries(trpc.project.getLlmConfigs.queryOptions());
		queryClient.invalidateQueries(trpc.project.getModelProvider.queryOptions());
		setNewProvider('');
		setNewApiKey('');
	};

	const handleDeleteConfig = async (provider: LlmProvider) => {
		await deleteLlmConfig.mutateAsync({ provider });
		queryClient.invalidateQueries(trpc.project.getLlmConfigs.queryOptions());
		queryClient.invalidateQueries(trpc.project.getModelProvider.queryOptions());
	};

	return (
		<div className='grid gap-4 pt-4 border-t border-border'>
			<h4 className='text-sm font-medium text-foreground'>LLM Providers</h4>

			{/* Environment-configured providers (read-only) */}
			{envProviders
				.filter((provider) => !projectConfiguredProviders.includes(provider))
				.map((provider) => (
					<div
						key={`env-${provider}`}
						className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'
					>
						<div className='flex-1 grid gap-1'>
							<span className='text-sm font-medium text-foreground capitalize'>{provider}</span>
							<span className='text-xs text-muted-foreground'>Configured from environment</span>
						</div>
						<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>
							ENV
						</span>
					</div>
				))}

			{/* Project-specific configs (editable) */}
			{projectConfigs.map((config) => (
				<div
					key={config.id}
					className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'
				>
					<div className='flex-1 grid gap-1'>
						<div className='flex items-center gap-2'>
							<span className='text-sm font-medium text-foreground capitalize'>{config.provider}</span>
							{envProviders.includes(config.provider as LlmProvider) && (
								<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary'>
									Override
								</span>
							)}
						</div>
						<span className='text-xs font-mono text-muted-foreground'>{config.apiKeyPreview}</span>
					</div>
					{isAdmin && (
						<Button
							variant='ghost'
							size='icon-sm'
							onClick={() => handleDeleteConfig(config.provider as LlmProvider)}
							disabled={deleteLlmConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					)}
				</div>
			))}

			{/* Add new config (admin only) */}
			{isAdmin && availableProviders.length > 0 && (
				<div className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'>
					<div className='grid gap-2'>
						<label className='text-sm font-medium text-foreground'>Add Provider</label>
						<div className='flex gap-2'>
							{availableProviders.map((provider) => (
								<button
									key={provider}
									type='button'
									onClick={() => setNewProvider(provider)}
									className={`
										px-4 py-2 rounded-md text-sm font-medium transition-all capitalize cursor-pointer
										${
											newProvider === provider
												? 'bg-primary text-primary-foreground'
												: 'bg-secondary text-muted-foreground hover:text-foreground'
										}
									`}
								>
									{provider}
									{envProviders.includes(provider) && (
										<span className='ml-1.5 text-[10px] opacity-70 normal-case'>
											(override env)
										</span>
									)}
								</button>
							))}
						</div>
					</div>
					{newProvider && (
						<>
							<div className='grid gap-2'>
								<label htmlFor='new-api-key' className='text-sm font-medium text-foreground'>
									API Key
								</label>
								<Input
									id='new-api-key'
									type='password'
									value={newApiKey}
									onChange={(e) => setNewApiKey(e.target.value)}
									placeholder={`Enter your ${capitalize(newProvider)} API key`}
								/>
							</div>
							<div className='flex justify-end gap-2'>
								<Button
									variant='ghost'
									size='sm'
									onClick={() => {
										setNewProvider('');
										setNewApiKey('');
									}}
								>
									Cancel
								</Button>
								<Button
									size='sm'
									onClick={handleAddConfig}
									disabled={!newApiKey || upsertLlmConfig.isPending}
								>
									<Plus className='size-4 mr-1' />
									Add
								</Button>
							</div>
						</>
					)}
				</div>
			)}

			{projectConfigs.length === 0 && envProviders.length === 0 && (
				<p className='text-sm text-muted-foreground'>
					{isAdmin
						? 'No providers configured. Add an API key above.'
						: 'No providers configured. Contact an admin to set up LLM providers.'}
				</p>
			)}
		</div>
	);
}
