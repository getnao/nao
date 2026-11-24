import { providerLabel } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { LlmModelIdsByConfig, LlmProvider } from '@nao/shared/types';

import { LlmAccessModeControl } from '@/components/settings/llm-access-mode-control';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { trpc } from '@/main';

export interface UserGroupLlmAccessValue {
	llmConfigIds: string[];
	llmModelIdsByConfig: LlmModelIdsByConfig;
}

export function UserGroupLlmAccess({
	llmConfigIds,
	llmModelIdsByConfig,
	inheritedLlmConfigIds = [],
	inheritedLlmModelIdsByConfig = {},
	allUsersGroupId,
	isLicensed,
	autoSave = false,
	saveStatus = 'idle',
	onChange,
}: {
	llmConfigIds: string[];
	llmModelIdsByConfig: LlmModelIdsByConfig;
	inheritedLlmConfigIds?: string[];
	inheritedLlmModelIdsByConfig?: LlmModelIdsByConfig;
	allUsersGroupId?: string;
	isLicensed: boolean;
	autoSave?: boolean;
	saveStatus?: 'idle' | 'saving' | 'saved';
	onChange: (value: UserGroupLlmAccessValue) => void;
}) {
	const configs = useQuery(trpc.project.getLlmConfigs.queryOptions());
	const readiness = useQuery(trpc.project.getLlmAccessReadiness.queryOptions());
	const projectConfigs = configs.data?.projectConfigs ?? [];
	const isRestricted = readiness.data?.mode === 'user_group';
	const allUsersGrantsEverything =
		allUsersGroupId !== undefined &&
		projectConfigs.every(
			(config) =>
				inheritedLlmConfigIds.includes(config.id) && !Object.hasOwn(inheritedLlmModelIdsByConfig, config.id),
		);
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
			onChange({
				llmConfigIds: availableIds,
				llmModelIdsByConfig: filterModelIdsByConfigs(llmModelIdsByConfig, activeIds),
			});
		}
	}, [configs.data, llmConfigIds, llmModelIdsByConfig, onChange]);

	const changeCredential = (configId: string, checked: boolean) => {
		onChange({
			llmConfigIds: checked
				? [...new Set([...llmConfigIds, configId])]
				: llmConfigIds.filter((id) => id !== configId),
			llmModelIdsByConfig: removeModelRestriction(llmModelIdsByConfig, configId),
		});
	};

	const changeModel = (configId: string, modelId: string, checked: boolean, availableModelIds: string[]) => {
		const currentModelIds = llmConfigIds.includes(configId)
			? (llmModelIdsByConfig[configId] ?? availableModelIds)
			: [];
		const nextModelIds = checked
			? [...new Set([...currentModelIds, modelId])]
			: currentModelIds.filter((id) => id !== modelId);
		if (nextModelIds.length === 0) {
			changeCredential(configId, false);
			return;
		}
		const grantsAllModels = availableModelIds.every((id) => nextModelIds.includes(id));
		onChange({
			llmConfigIds: [...new Set([...llmConfigIds, configId])],
			llmModelIdsByConfig: grantsAllModels
				? removeModelRestriction(llmModelIdsByConfig, configId)
				: { ...llmModelIdsByConfig, [configId]: nextModelIds },
		});
	};

	return (
		<section className='flex min-w-0 flex-col gap-4'>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
				<div>
					<div className='flex items-center gap-2'>
						<h3 className='text-sm font-medium'>LLM credentials</h3>
						<span role='status' className='inline-block w-14 text-xs text-muted-foreground'>
							{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : null}
						</span>
					</div>
					{isRestricted && (
						<p className='mt-1 text-xs text-muted-foreground'>
							Choose which credentials provide models to members of this group. Users in multiple groups
							receive the union of their assignments.{autoSave && ' Changes save automatically.'}
						</p>
					)}
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			<LlmAccessModeControl />
			{configs.isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading LLM credentials...</p>
			) : configs.isError ? (
				<Callout variant='destructive'>Failed to load LLM credentials.</Callout>
			) : projectConfigs.length === 0 ? (
				<NoProjectCredentials inheritedProviders={inheritedProviders} />
			) : (
				<LockedFieldset disabled={!isLicensed} className='gap-3'>
					{isRestricted && allUsersGrantsEverything && (
						<Callout>
							All Users already grants every model, so this group adds nothing.{' '}
							<Link
								to='/settings/project/user-groups/$groupId'
								params={{ groupId: allUsersGroupId }}
								search={{ tab: 'llm-access' }}
								className='underline underline-offset-2 hover:text-foreground'
							>
								Remove models from All Users
							</Link>{' '}
							to reserve them for specific groups.
						</Callout>
					)}
					<div className='grid gap-3' role='group' aria-label='Allowed LLM credentials'>
						{projectConfigs.map((config) => {
							const checkboxId = `user-group-llm-config-${config.id}`;
							const inherited = inheritedLlmConfigIds.includes(config.id);
							const directlyAssigned = llmConfigIds.includes(config.id);
							const inheritedAll =
								!isRestricted || (inherited && !Object.hasOwn(inheritedLlmModelIdsByConfig, config.id));
							const accessBadge = !isRestricted
								? 'All members'
								: inherited
									? 'Inherited from All Users'
									: null;
							const directAll = !Object.hasOwn(llmModelIdsByConfig, config.id);
							const directModelIds = llmModelIdsByConfig[config.id] ?? [];
							const inheritedModelIds = inheritedLlmModelIdsByConfig[config.id] ?? [];
							const availableModels = config.availableModels ?? [];
							return (
								<div key={config.id} className='flex min-w-0 flex-col gap-3 rounded-lg border p-3'>
									<div className='flex min-w-0 items-start gap-3'>
										<Checkbox
											id={checkboxId}
											checked={directlyAssigned || inheritedAll}
											disabled={inheritedAll}
											onCheckedChange={(nextChecked) =>
												changeCredential(config.id, nextChecked === true)
											}
										/>
										<LlmProviderIcon
											provider={config.provider}
											baseUrl={config.baseUrl}
											className='mt-0.5 size-4 shrink-0'
										/>
										<label
											htmlFor={checkboxId}
											className={`min-w-0 flex-1 ${inheritedAll ? 'cursor-default' : 'cursor-pointer'}`}
										>
											<span className='flex flex-wrap items-center gap-1 text-sm font-medium'>
												<span className='truncate'>{config.name}</span>
												{accessBadge && (
													<span className='rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground'>
														{accessBadge}
													</span>
												)}
											</span>
											{config.name.toLowerCase() !==
												providerLabel(config.provider).toLowerCase() && (
												<span className='block truncate text-xs text-muted-foreground'>
													{providerLabel(config.provider)}
												</span>
											)}
										</label>
									</div>
									{(directlyAssigned || inheritedAll || inherited) && availableModels.length > 0 && (
										<div
											className='grid gap-2 border-t pt-3 sm:grid-cols-2'
											role='group'
											aria-label={`${config.name} models`}
										>
											{availableModels.map((model) => {
												const modelInherited =
													inheritedAll || inheritedModelIds.includes(model.id);
												const modelDirect =
													directlyAssigned &&
													(directAll || directModelIds.includes(model.id));
												const modelCheckboxId = `${checkboxId}-${model.id}`;
												return (
													<label
														key={model.id}
														htmlFor={modelCheckboxId}
														className='flex min-w-0 items-center gap-2 text-sm'
													>
														<Checkbox
															id={modelCheckboxId}
															checked={modelInherited || modelDirect}
															disabled={modelInherited}
															onCheckedChange={(checked) =>
																changeModel(
																	config.id,
																	model.id,
																	checked === true,
																	availableModels.map((candidate) => candidate.id),
																)
															}
														/>
														<span className='min-w-0 truncate'>
															{model.name}
															{modelInherited && isRestricted && (
																<span className='ml-1 text-xs text-muted-foreground'>
																	(inherited)
																</span>
															)}
														</span>
													</label>
												);
											})}
										</div>
									)}
									{(directlyAssigned || inheritedAll || inherited) &&
										availableModels.length === 0 && (
											<p className='text-xs text-muted-foreground'>
												This credential currently exposes no models.
											</p>
										)}
								</div>
							);
						})}
					</div>
				</LockedFieldset>
			)}
		</section>
	);
}

function removeModelRestriction(llmModelIdsByConfig: LlmModelIdsByConfig, configId: string): LlmModelIdsByConfig {
	return Object.fromEntries(Object.entries(llmModelIdsByConfig).filter(([id]) => id !== configId));
}

function filterModelIdsByConfigs(
	llmModelIdsByConfig: LlmModelIdsByConfig,
	configIds: ReadonlySet<string>,
): LlmModelIdsByConfig {
	return Object.fromEntries(Object.entries(llmModelIdsByConfig).filter(([configId]) => configIds.has(configId)));
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
