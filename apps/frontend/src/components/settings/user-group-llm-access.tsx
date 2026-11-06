import { providerLabel } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { LlmProvider } from '@nao/shared/types';

import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { trpc } from '@/main';

export function UserGroupLlmAccess({
	llmConfigIds,
	inheritedLlmConfigIds = [],
	isLicensed,
	autoSave = false,
	isSaving = false,
	onChange,
}: {
	llmConfigIds: string[];
	inheritedLlmConfigIds?: string[];
	isLicensed: boolean;
	autoSave?: boolean;
	isSaving?: boolean;
	onChange: (llmConfigIds: string[]) => void;
}) {
	const configs = useQuery(trpc.project.getLlmConfigs.queryOptions());
	const projectConfigs = configs.data?.projectConfigs ?? [];
	const inheritedProviders = [
		...new Set([
			...(configs.data?.configProviders ?? []).map((config) => config.provider),
			...(configs.data?.envProviders ?? []),
		]),
	];

	useEffect(() => {
		if (!configs.data) {
			return;
		}
		const activeIds = new Set(configs.data.projectConfigs.map((config) => config.id));
		const availableIds = llmConfigIds.filter((configId) => activeIds.has(configId));
		if (availableIds.length !== llmConfigIds.length) {
			onChange(availableIds);
		}
	}, [configs.data, llmConfigIds, onChange]);

	return (
		<section className='flex min-w-0 flex-col gap-4'>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
				<div>
					<div className='flex items-center gap-2'>
						<h3 className='text-sm font-medium'>LLM credentials</h3>
						{isSaving && (
							<span role='status' className='text-xs text-muted-foreground'>
								Saving...
							</span>
						)}
					</div>
					<p className='mt-1 text-xs text-muted-foreground'>
						Choose which credentials provide models to members of this group. Users in multiple groups
						receive the union of their assignments.{autoSave && ' Changes save automatically.'}
					</p>
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			{configs.isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading LLM credentials...</p>
			) : configs.isError ? (
				<Callout variant='destructive'>Failed to load LLM credentials.</Callout>
			) : projectConfigs.length === 0 ? (
				<NoProjectCredentials inheritedProviders={inheritedProviders} />
			) : (
				<LockedFieldset disabled={!isLicensed || isSaving} className='gap-2'>
					<div className='grid gap-2 sm:grid-cols-2' role='group' aria-label='Allowed LLM credentials'>
						{projectConfigs.map((config) => {
							const checkboxId = `user-group-llm-config-${config.id}`;
							const inherited = inheritedLlmConfigIds.includes(config.id);
							const directlyAssigned = llmConfigIds.includes(config.id);
							const checked = directlyAssigned || inherited;
							const credentialPreview =
								(config.credentialSource === 'env' ? 'ENV' : config.apiKeyPreview) ??
								(config.credentialPreviews
									? Object.values(config.credentialPreviews).join(', ')
									: null);
							return (
								<label
									key={config.id}
									htmlFor={checkboxId}
									className={`flex min-w-0 items-start gap-3 rounded-lg border p-3 transition-colors ${
										inherited ? 'cursor-default' : 'cursor-pointer hover:bg-muted/40'
									}`}
								>
									<Checkbox
										id={checkboxId}
										checked={checked}
										disabled={inherited}
										onCheckedChange={(nextChecked) =>
											onChange(
												nextChecked
													? [...llmConfigIds, config.id]
													: llmConfigIds.filter((id) => id !== config.id),
											)
										}
									/>
									<LlmProviderIcon
										provider={config.provider}
										baseUrl={config.baseUrl}
										className='mt-0.5 size-4 shrink-0'
									/>
									<span className='min-w-0'>
										<span className='flex flex-wrap items-center gap-1 text-sm font-medium'>
											<span className='truncate'>{config.name}</span>
											{inherited && (
												<span className='rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground'>
													Inherited from All Users
												</span>
											)}
										</span>
										<span className='block truncate text-xs text-muted-foreground'>
											{providerLabel(config.provider)}
											{credentialPreview ? ` · ${credentialPreview}` : ''}
										</span>
										{(config.enabledModels?.length ?? 0) > 0 && (
											<span className='block truncate text-xs text-muted-foreground'>
												{config.enabledModels?.join(', ')}
											</span>
										)}
									</span>
								</label>
							);
						})}
					</div>
				</LockedFieldset>
			)}
		</section>
	);
}

function NoProjectCredentials({ inheritedProviders }: { inheritedProviders: LlmProvider[] }) {
	return (
		<div className='flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground'>
			<p>
				No assignable project credentials are configured.
				{inheritedProviders.length > 0 &&
					' Environment and nao_config.yaml providers must first be saved as project credentials.'}
			</p>
			<div className='flex flex-wrap gap-x-3 gap-y-1'>
				{inheritedProviders.length > 0 ? (
					inheritedProviders.map((provider) => (
						<Link
							key={provider}
							to='/settings/project/agent'
							search={{ tab: 'models', provider }}
							className='text-foreground underline'
						>
							Save {providerLabel(provider)} as a project credential
						</Link>
					))
				) : (
					<Link to='/settings/project/agent' search={{ tab: 'models' }} className='text-foreground underline'>
						Configure an LLM provider
					</Link>
				)}
			</div>
		</div>
	);
}
