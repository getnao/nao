import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Switch } from '@/components/ui/switch';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

export function LlmAccessModeControl() {
	const queryClient = useQueryClient();
	const [confirmActivation, setConfirmActivation] = useState(false);
	const license = useLicenseFeatures();
	const readiness = useQuery(trpc.project.getLlmAccessReadiness.queryOptions());
	const updateMode = useMutation(
		trpc.project.updateLlmAccessMode.mutationOptions({
			onSuccess: async () => {
				setConfirmActivation(false);
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.project.getLlmAccessReadiness.queryOptions().queryKey,
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.project.listAvailableTranscribeModels.queryOptions().queryKey,
					}),
					queryClient.invalidateQueries({ queryKey: trpc.userGroup.overview.queryOptions().queryKey }),
				]);
			},
		}),
	);
	const isLicensed = license.data?.['user-groups'] === true;
	const isRestricted = readiness.data?.mode === 'user_group';
	const disabled = license.isLoading || readiness.isLoading || updateMode.isPending || (!isLicensed && !isRestricted);
	const warning = readiness.data ? describeReadiness(readiness.data) : null;
	const showWarning = warning && isRestricted;

	return (
		<section className='flex flex-col gap-3 rounded-lg border p-3 sm:p-4'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
				<div className='min-w-0'>
					<div className='flex flex-wrap items-center gap-2'>
						<label htmlFor='restrict-models-by-user-group' className='text-sm font-medium'>
							Restrict models by user group
						</label>
						{!license.isLoading && !isLicensed && <UpgradeToEnterprise />}
					</div>
					<p className='mt-1 text-xs text-muted-foreground'>
						{isRestricted
							? 'Members only see models from credentials assigned to their groups. Applies to every group.'
							: 'Off: every member can use every model. Turn on to choose models per group.'}
					</p>
				</div>
				<Switch
					id='restrict-models-by-user-group'
					checked={isRestricted}
					disabled={disabled}
					onCheckedChange={(checked) => {
						if (checked) {
							setConfirmActivation(true);
						} else {
							updateMode.mutate({ mode: 'project' });
						}
					}}
				/>
			</div>
			{readiness.isError && (
				<Callout variant='destructive'>Failed to load the model access configuration.</Callout>
			)}
			{showWarning && <Callout variant='warning'>{warning}</Callout>}
			{updateMode.error && <Callout variant='destructive'>{updateMode.error.message}</Callout>}
			<ConfirmationDialog
				open={confirmActivation}
				onOpenChange={setConfirmActivation}
				title='Restrict model access by user group?'
				description={
					readiness.data?.assignedConfigCount === 0
						? describeAllUsersSeeding(readiness.data.ignoredProviderIds.length)
						: `${warning ? `${warning} ` : ''}Each user will only be able to run models assigned through their groups.`
				}
				confirmLabel='Enable restrictions'
				confirmVariant='default'
				isPending={updateMode.isPending}
				error={updateMode.error?.message}
				preventCloseWhilePending
				onConfirm={() => updateMode.mutate({ mode: 'user_group' })}
			/>
		</section>
	);
}

export function LlmAccessModeSummary() {
	const readiness = useQuery(trpc.project.getLlmAccessReadiness.queryOptions());
	if (!readiness.data) {
		return null;
	}
	return (
		<section className='flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:p-4'>
			<span>
				<span className='font-medium'>Model access: </span>
				<span className='text-muted-foreground'>
					{readiness.data.mode === 'user_group' ? 'restricted by user group' : 'every member, every model'}
				</span>
			</span>
			<Button variant='secondary' size='sm' className='w-fit' asChild>
				<Link to='/settings/project/user-groups' search={{ tab: 'groups' }}>
					Manage in Users & Groups
				</Link>
			</Button>
		</section>
	);
}

function describeAllUsersSeeding(ignoredProviderCount: number): string {
	const lostProviders =
		ignoredProviderCount > 0
			? ` Models from ${ignoredProviderCount} ${ignoredProviderCount === 1 ? 'provider' : 'providers'} not saved as project credentials will stop being available.`
			: '';
	return `All Users will start with every project credential, so members keep those models.${lostProviders} Then remove models from All Users to reserve them for specific groups.`;
}

function describeReadiness(readiness: {
	mode: 'project' | 'user_group';
	canEnable: boolean;
	assignedConfigCount: number;
	staleConfigIds: string[];
	unassignedGroupIds: string[];
	userIdsWithoutModels: string[];
	ignoredProviderIds: string[];
	staleDefaultCount: number;
	staleAutomationIds: string[];
}): string | null {
	if (!readiness.canEnable) {
		return 'Assign at least one active LLM credential in a group’s LLM Access tab before enabling restrictions.';
	}
	const issues = [
		readiness.userIdsWithoutModels.length > 0
			? `${readiness.userIdsWithoutModels.length} ${readiness.userIdsWithoutModels.length === 1 ? 'user has' : 'users have'} no assigned models`
			: null,
		readiness.unassignedGroupIds.length > 0
			? `${readiness.unassignedGroupIds.length} ${readiness.unassignedGroupIds.length === 1 ? 'group has' : 'groups have'} no available models`
			: null,
		readiness.staleConfigIds.length > 0
			? `${readiness.staleConfigIds.length} stale credential ${readiness.staleConfigIds.length === 1 ? 'assignment needs' : 'assignments need'} cleanup`
			: null,
		readiness.ignoredProviderIds.length > 0
			? `${readiness.ignoredProviderIds.length} non-assignable ${readiness.ignoredProviderIds.length === 1 ? 'provider will be' : 'providers will be'} ignored`
			: null,
		readiness.staleDefaultCount > 0
			? `${readiness.staleDefaultCount} project model ${readiness.staleDefaultCount === 1 ? 'default references' : 'defaults reference'} a credential unavailable under user-group restrictions`
			: null,
		readiness.staleAutomationIds.length > 0
			? `${readiness.staleAutomationIds.length} ${readiness.staleAutomationIds.length === 1 ? 'automation references' : 'automations reference'} an unavailable credential`
			: null,
	].filter((issue): issue is string => issue !== null);
	return issues.length > 0 ? `${issues.join('; ')}.` : null;
}
