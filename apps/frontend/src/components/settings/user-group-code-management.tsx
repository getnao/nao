import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc, trpcClient } from '@/main';

export function UserGroupCodeManagement() {
	const status = useQuery(trpc.userGroup.managementStatus.queryOptions());

	if (!status.data) {
		return null;
	}
	const { mode, configPath, lastSuccess, latestFailure } = status.data;
	const isCodeManaged = mode === 'code';
	const pendingEmails = status.data.pendingEmails ?? [];
	const activeFailure =
		latestFailure && (!lastSuccess || toTimestamp(latestFailure.completedAt) > toTimestamp(lastSuccess.completedAt))
			? latestFailure
			: null;
	return (
		<SettingsCard
			title='User group management'
			description={
				isCodeManaged
					? `${configPath} is the source of truth for groups, memberships, and access settings.`
					: `Add ${configPath} at the project root and deploy it to manage groups as code.`
			}
			action={
				<Button variant='secondary' onClick={() => void downloadConfig()}>
					<Download />
					Download YAML
				</Button>
			}
		>
			{(isCodeManaged || activeFailure) && (
				<div className='space-y-2 text-sm'>
					{isCodeManaged && lastSuccess && (
						<p className='text-muted-foreground'>
							Last synced {formatTime(lastSuccess.completedAt)} by{' '}
							{lastSuccess.actorName ?? lastSuccess.actorEmail ?? 'nao at startup'}.
						</p>
					)}
					{activeFailure && (
						<p className='text-destructive'>
							Last attempt failed {formatTime(activeFailure.completedAt)}:{' '}
							{activeFailure.errorMessage ?? 'Unknown error'}
						</p>
					)}
					{pendingEmails.length > 0 && (
						<p className='text-amber-700 dark:text-amber-400'>
							Pending members: {pendingEmails.join(', ')}
						</p>
					)}
				</div>
			)}
		</SettingsCard>
	);
}

async function downloadConfig(): Promise<void> {
	const config = await trpcClient.userGroup.exportConfig.query();
	const url = URL.createObjectURL(new Blob([config.source], { type: 'application/yaml' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = config.filename;
	link.click();
	URL.revokeObjectURL(url);
}

function formatTime(value: Date | string | null): string {
	return value ? new Date(value).toLocaleString() : '';
}

function toTimestamp(value: Date | string | null): number {
	return value ? new Date(value).getTime() : 0;
}
