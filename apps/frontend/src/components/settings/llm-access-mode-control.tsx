import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Callout } from '@/components/ui/callout';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Switch } from '@/components/ui/switch';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

export function LlmAccessModeControl() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
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
				]);
			},
		}),
	);
	const isLicensed = license.data?.['user-groups'] === true;
	const isRestricted = readiness.data?.mode === 'user_group';
	const canEnable = readiness.data?.canEnable === true;
	const disabled = license.isLoading || readiness.isLoading || updateMode.isPending || !isLicensed;
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
						When enabled, users only see models from credentials assigned to their groups.
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
				title={canEnable ? 'Restrict model access by user group?' : 'Set up LLM access first'}
				description={
					canEnable
						? `${warning ? `${warning} ` : ''}YAML-only credentials will no longer be available. Users without an assigned active credential cannot run models.`
						: (warning ?? 'Assign an active LLM credential to a user group before enabling restrictions.')
				}
				confirmLabel={canEnable ? 'Enable restrictions' : 'Go to Users & Groups'}
				confirmVariant='default'
				isPending={updateMode.isPending}
				error={updateMode.error?.message}
				preventCloseWhilePending
				onConfirm={() => {
					if (canEnable) {
						updateMode.mutate({ mode: 'user_group' });
					} else {
						setConfirmActivation(false);
						void navigate({
							to: '/settings/project/user-groups',
							search: { tab: 'groups' },
						});
					}
				}}
			/>
		</section>
	);
}

function describeReadiness(readiness: {
	mode: 'project' | 'user_group';
	canEnable: boolean;
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
			? `${readiness.unassignedGroupIds.length} ${readiness.unassignedGroupIds.length === 1 ? 'group has' : 'groups have'} no credentials`
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
