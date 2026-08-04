import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, CircleX, Cloud, HardDrive, Info, Loader2, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { useStorageConfig, useStorageHealth } from '@/hooks/use-storage';
import { requireAdminNonCloud } from '@/lib/require-admin';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_sidebar-layout/settings/storage')({
	beforeLoad: requireAdminNonCloud,
	component: StoragePage,
});

function StoragePage() {
	const config = useStorageConfig();
	const health = useStorageHealth();

	if (config.isLoading) {
		return (
			<SettingsPageWrapper>
				<div className='text-sm text-muted-foreground'>Loading storage configuration…</div>
			</SettingsPageWrapper>
		);
	}

	if (config.isError || !config.data) {
		return (
			<SettingsPageWrapper>
				<div className='text-sm text-destructive'>Failed to load storage configuration.</div>
			</SettingsPageWrapper>
		);
	}

	const { backend, local, s3 } = config.data;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Storage</h1>
					<p className='text-sm text-muted-foreground'>
						Permanent storage is where the agent keeps files that outlive a chat. It is configured once for
						the whole nao instance through environment variables, and each user gets their own space within
						every project they belong to.
					</p>
				</div>

				<HealthCard isLoading={health.isLoading} ok={health.data?.ok} error={health.data?.error} />

				<SettingsCard title='Configuration' description='Read-only — set through environment variables.'>
					<DetailRow
						label='Backend'
						value={
							<div className='flex items-center gap-2'>
								{backend === 's3' ? <Cloud className='size-3.5' /> : <HardDrive className='size-3.5' />}
								<span>{backend === 's3' ? 'S3-compatible bucket' : 'Local directory'}</span>
								<EnvBadge />
							</div>
						}
					/>

					{local && <DetailRow label='Path' value={<Mono>{local.path}</Mono>} />}

					{s3 && (
						<>
							<DetailRow label='Bucket' value={<Mono>{s3.bucket}</Mono>} />
							<DetailRow label='Region' value={s3.region ? <Mono>{s3.region}</Mono> : <NotSet />} />
							<DetailRow
								label='Endpoint'
								value={s3.endpoint ? <Mono>{s3.endpoint}</Mono> : <Muted>AWS S3</Muted>}
							/>
							<DetailRow
								label='Key prefix'
								value={s3.prefix ? <Mono>{s3.prefix}/</Mono> : <Muted>bucket root</Muted>}
							/>
							<DetailRow
								label='Path-style addressing'
								value={s3.forcePathStyle ? 'Enabled' : 'Disabled'}
							/>
							<DetailRow
								label='Credentials'
								value={
									s3.credentialSource === 'explicit' ? (
										<div className='flex items-center gap-2'>
											<Mono>{s3.accessKeyId}</Mono>
											<EnvBadge />
										</div>
									) : (
										<Muted>Default AWS credential chain</Muted>
									)
								}
							/>
						</>
					)}

					<DetailRow label='File layout' value={<Mono>projects/&lt;project&gt;/users/&lt;user&gt;/…</Mono>} />
				</SettingsCard>

				{backend === 'local' && <SharedVolumeNotice />}
			</div>
		</SettingsPageWrapper>
	);
}

function HealthCard({ isLoading, ok, error }: { isLoading: boolean; ok?: boolean; error?: string }) {
	if (isLoading) {
		return (
			<div className='flex items-center gap-3 p-4 rounded-xl border border-border bg-muted/30'>
				<Loader2 className='size-4 animate-spin text-muted-foreground' />
				<span className='text-sm text-muted-foreground'>Checking storage…</span>
			</div>
		);
	}

	const isHealthy = ok === true;

	return (
		<div
			className={cn(
				'flex items-start gap-3 p-4 rounded-xl border',
				isHealthy ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5',
			)}
		>
			<div
				className={cn(
					'shrink-0 rounded-full p-2',
					isHealthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
				)}
			>
				{isHealthy ? <CheckCircle2 className='size-4' /> : <CircleX className='size-4' />}
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<div className='flex items-center gap-2'>
					<span className='font-semibold text-foreground'>
						{isHealthy ? 'Storage reachable' : 'Storage unreachable'}
					</span>
					<Badge
						variant='ghost'
						className={cn(
							'uppercase text-[10px] font-semibold',
							isHealthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
						)}
					>
						{isHealthy ? 'ok' : 'error'}
					</Badge>
				</div>
				<p className='text-sm text-muted-foreground'>
					{isHealthy
						? 'nao can read and write files in the configured location.'
						: (error ?? 'The storage location could not be reached.')}
				</p>
			</div>
		</div>
	);
}

function SharedVolumeNotice() {
	return (
		<div className='flex items-start gap-3 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5'>
			<div className='shrink-0 rounded-full p-2 bg-yellow-500/10 text-yellow-500'>
				<TriangleAlert className='size-4' />
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<span className='font-semibold text-foreground'>Running more than one replica?</span>
				<p className='text-sm text-muted-foreground'>
					A local directory is only shared between replicas if you make it so. Mount the same read-write-many
					volume at this path on every replica — NFS, Amazon EFS, Google Filestore or a RWX
					PersistentVolumeClaim — otherwise each replica sees a different set of files. Switching to the{' '}
					<Mono>s3</Mono> backend avoids the problem entirely.
				</p>
			</div>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className='flex items-center justify-between gap-4 py-1'>
			<span className='text-sm text-muted-foreground shrink-0'>{label}</span>
			<div className='text-sm text-foreground text-right min-w-0 break-all'>{value}</div>
		</div>
	);
}

function EnvBadge() {
	return <span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>ENV</span>;
}

function Mono({ children }: { children: React.ReactNode }) {
	return <code className='font-mono text-xs'>{children}</code>;
}

function NotSet() {
	return (
		<div className='flex items-center gap-1.5 text-muted-foreground'>
			<Info className='size-3.5' />
			<span className='text-xs'>Not set</span>
		</div>
	);
}

function Muted({ children }: { children: React.ReactNode }) {
	return <span className='text-xs text-muted-foreground'>{children}</span>;
}
