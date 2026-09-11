import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import type { WebRobotListItem } from '@/components/settings/web-source-recipe';
import { WebSourceList } from '@/components/settings/web-source-list';
import { isActiveWebRobotRun } from '@/components/settings/web-source-recipe';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { requireWebRobotsEnabled } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/web-sources/')({
	beforeLoad: requireWebRobotsEnabled,
	staticData: {
		title: 'Web sources',
		description: 'Manage deterministic web catalogue robots.',
	},
	component: WebSourcesPage,
});

function WebSourcesPage() {
	const queryClient = useQueryClient();
	const [archiveError, setArchiveError] = useState<string | null>(null);
	const storage = useQuery(trpc.storage.getUploadLimits.queryOptions());
	const storageEnabled = storage.data?.enabled === true;
	const robots = useQuery({
		...trpc.webRobot.list.queryOptions(),
		enabled: storageEnabled,
		refetchInterval: (query) =>
			query.state.data?.some((robot) => isActiveWebRobotRun(robot.lastRunStatus)) ? 3000 : false,
	});
	const runNow = useMutation(trpc.webRobot.runNow.mutationOptions());
	const setEnabled = useMutation(trpc.webRobot.setEnabled.mutationOptions());
	const archive = useMutation(trpc.webRobot.archive.mutationOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.webRobot.list.queryKey() });
	};

	const handleRunNow = async (robot: WebRobotListItem) => {
		await runNow.mutateAsync({ id: robot.id });
		await invalidate();
	};

	const handleSetEnabled = async (robot: WebRobotListItem, enabled: boolean) => {
		await setEnabled.mutateAsync({ id: robot.id, enabled });
		await invalidate();
	};

	const handleArchive = async (robot: WebRobotListItem) => {
		setArchiveError(null);
		try {
			await archive.mutateAsync({ id: robot.id });
			await invalidate();
		} catch (error) {
			setArchiveError(error instanceof Error ? error.message : String(error));
			throw error;
		}
	};

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-6'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Web sources</h1>
					<p className='text-sm text-muted-foreground'>
						Deterministic web robots that publish product catalogue datasets for the agent.
					</p>
				</div>

				{storage.isLoading && (
					<SettingsCard>
						<div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
							<Spinner /> Checking storage…
						</div>
					</SettingsCard>
				)}

				{storage.data && !storageEnabled && (
					<SettingsCard title='Storage required'>
						<ErrorMessage message='Permanent storage is disabled. Enable local or S3 storage before creating web sources.' />
					</SettingsCard>
				)}

				{robots.error && <ErrorMessage message={robots.error.message} />}
				{runNow.error && <ErrorMessage message={runNow.error.message} />}
				{setEnabled.error && <ErrorMessage message={setEnabled.error.message} />}

				{storageEnabled && robots.isLoading && (
					<SettingsCard>
						<div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
							<Spinner /> Loading web sources…
						</div>
					</SettingsCard>
				)}

				{storageEnabled && robots.data && (
					<WebSourceList
						robots={robots.data}
						onRunNow={handleRunNow}
						onSetEnabled={handleSetEnabled}
						onArchive={handleArchive}
						runningRobotId={runNow.isPending ? (runNow.variables?.id ?? null) : null}
						archivingRobotId={archive.isPending ? (archive.variables?.id ?? null) : null}
						archiveError={archiveError}
					/>
				)}
			</div>
		</SettingsPageWrapper>
	);
}
