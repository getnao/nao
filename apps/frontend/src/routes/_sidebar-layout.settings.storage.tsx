import { createFileRoute } from '@tanstack/react-router';
import { Ban, Cloud, HardDrive, Info, TriangleAlert } from 'lucide-react';

import type { displayChart } from '@nao/shared/tools';

import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { usePermissions } from '@/hooks/use-permissions';
import { useStorageConfig, useStorageHealth, useStorageUploadLimits, useStorageUsage } from '@/hooks/use-storage';
import { requireNonViewerNonCloud } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/storage')({
	beforeLoad: requireNonViewerNonCloud,
	component: StoragePage,
});

type StorageBackend = NonNullable<ReturnType<typeof useStorageConfig>['data']>['backend'];
type StorageUsageQuery = ReturnType<typeof useStorageUsage>;

function StoragePage() {
	const { isAdmin } = usePermissions();
	return isAdmin ? <AdminStoragePage /> : <MyStoragePage />;
}

function StoragePageLayout({ description, children }: { description: React.ReactNode; children: React.ReactNode }) {
	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Storage</h1>
					<p className='text-sm text-muted-foreground'>{description}</p>
				</div>
				<div className='flex flex-col gap-12'>{children}</div>
			</div>
		</SettingsPageWrapper>
	);
}

function AdminStoragePage() {
	const config = useStorageConfig();
	const isEnabled = config.data ? config.data.backend !== 'none' : false;
	const health = useStorageHealth({ enabled: isEnabled });
	const usage = useStorageUsage({ enabled: isEnabled });
	const description = (
		<>
			Permanent storage is where the agent keeps files that outlive a chat. It appears to the agent as the{' '}
			<Mono>/home</Mono> folder for each user, alongside the project context.
		</>
	);

	if (config.isLoading) {
		return (
			<StoragePageLayout description={description}>
				<div className='text-sm text-muted-foreground'>Loading storage configuration…</div>
			</StoragePageLayout>
		);
	}

	if (config.isError || !config.data) {
		return (
			<StoragePageLayout description={description}>
				<div className='text-sm text-destructive'>Failed to load storage configuration.</div>
			</StoragePageLayout>
		);
	}

	const { backend, local, s3, maxFileSizeMb } = config.data;

	return (
		<StoragePageLayout description={description}>
			{backend === 'none' ? (
				<DisabledNotice>
					The agent cannot save files, and files saved earlier are not reachable. Set{' '}
					<Mono>NAO_STORAGE_BACKEND</Mono> to <Mono>local</Mono> or <Mono>s3</Mono> to turn it on.
				</DisabledNotice>
			) : (
				<>
					{!health.isLoading && health.data?.ok === false && (
						<ErrorMessage message={health.data.error ?? 'The storage location could not be reached.'} />
					)}
					<ProjectUsageCard usage={usage} />
				</>
			)}

			<SettingsCard title='Configuration' description='Read-only — set through environment variables.'>
				{backend !== 'none' && (
					<DetailRow
						label='Status'
						value={
							health.isLoading ? (
								<Muted>Checking…</Muted>
							) : health.data?.ok ? (
								'Reachable'
							) : (
								<span className='text-destructive'>Unreachable</span>
							)
						}
					/>
				)}
				<DetailRow
					label='Backend'
					value={
						<div className='flex items-center gap-2'>
							<BackendIcon backend={backend} />
							<span>{BACKEND_LABELS[backend]}</span>
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
						<DetailRow label='Path-style addressing' value={s3.forcePathStyle ? 'Enabled' : 'Disabled'} />
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

				{backend !== 'none' && (
					<>
						<DetailRow
							label='Max file size'
							value={
								<div className='flex items-center gap-2'>
									<span>{maxFileSizeMb} MB</span>
									<EnvBadge />
								</div>
							}
						/>
						<DetailRow
							label='File layout'
							value={<Mono>projects/&lt;project&gt;/users/&lt;user&gt;/…</Mono>}
						/>
					</>
				)}
			</SettingsCard>

			{backend === 'local' && <SharedVolumeNotice />}
		</StoragePageLayout>
	);
}

function MyStoragePage() {
	const limits = useStorageUploadLimits();
	const isEnabled = limits.data?.enabled === true;
	const usage = useStorageUsage({ enabled: isEnabled });
	const limitsError = limits.error instanceof Error ? limits.error.message : 'Failed to load storage configuration.';
	const description =
		'Permanent storage is where the agent keeps files that outlive a chat: the exports it writes, the spreadsheets it builds, and the files you attach to a message. You get your own space in every project you belong to, and nobody else can read it.';

	return (
		<StoragePageLayout description={description}>
			{limits.isError ? (
				<ErrorMessage message={limitsError} />
			) : limits.isPending ? (
				<div className='text-sm text-muted-foreground'>Loading storage configuration…</div>
			) : !isEnabled ? (
				<DisabledNotice>
					You have no space on this nao instance, and the agent cannot save files for you. Ask an admin to
					turn permanent storage on.
				</DisabledNotice>
			) : (
				<SettingsCard title='Your space' description='Files stored for you in this project.'>
					<OwnUsageKpis usage={usage} />
				</SettingsCard>
			)}
		</StoragePageLayout>
	);
}

const BYTES_VALUE_FORMAT = {
	d3_format: '.2s',
	suffix: 'B',
	compact: 'si',
} satisfies displayChart.ValueFormat;

const COUNT_VALUE_FORMAT = { d3_format: ',.0f' } satisfies displayChart.ValueFormat;

function ProjectUsageCard({ usage }: { usage: StorageUsageQuery }) {
	const byUser = usage.data?.byUser ?? [];
	const totals = byUser.reduce(
		(total, user) => ({
			fileCount: total.fileCount + user.fileCount,
			totalBytes: total.totalBytes + user.totalBytes,
		}),
		{ fileCount: 0, totalBytes: 0 },
	);
	const perUserData = byUser.map((user) => ({
		user: user.name,
		fileCount: user.fileCount,
		totalBytes: user.totalBytes,
	}));

	return (
		<SettingsCard title='Usage' description='Files kept by everyone in this project.'>
			<UsageState query={usage} isEmpty={byUser.length === 0}>
				<ChartDisplay
					data={[
						{
							scope: 'project',
							fileCount: totals.fileCount,
							totalBytes: totals.totalBytes,
							userCount: byUser.length,
						},
					]}
					chartType='kpi_card'
					xAxisKey='scope'
					xAxisType='category'
					series={[
						{
							data_key: 'fileCount',
							label: 'Files',
							color: 'var(--chart-1)',
							value_format: COUNT_VALUE_FORMAT,
						},
						{
							data_key: 'totalBytes',
							label: 'Size occupied',
							color: 'var(--chart-2)',
							value_format: BYTES_VALUE_FORMAT,
						},
						{
							data_key: 'userCount',
							label: 'Users with files',
							color: 'var(--chart-3)',
							value_format: COUNT_VALUE_FORMAT,
						},
					]}
				/>

				<ChartDisplay
					title='Usage by user'
					titleStyle='left'
					data={perUserData}
					chartType='mixed'
					xAxisKey='user'
					xAxisType='category'
					yAxisLabel='Size occupied'
					yAxisRightLabel='Files'
					series={[
						{
							data_key: 'totalBytes',
							label: 'Size occupied',
							color: 'var(--chart-2)',
							series_type: 'bar',
							y_axis: 'left',
							value_format: BYTES_VALUE_FORMAT,
						},
						{
							data_key: 'fileCount',
							label: 'Files',
							color: 'var(--chart-1)',
							series_type: 'bar',
							y_axis: 'right',
							value_format: COUNT_VALUE_FORMAT,
						},
					]}
					chartContainerClassName='h-[280px] max-h-[280px]'
				/>
			</UsageState>
		</SettingsCard>
	);
}

function OwnUsageKpis({ usage }: { usage: StorageUsageQuery }) {
	const own = usage.data?.own;

	return (
		<UsageState query={usage} isEmpty={false}>
			<ChartDisplay
				data={[
					{
						scope: 'own',
						fileCount: own?.fileCount ?? 0,
						totalBytes: own?.totalBytes ?? 0,
					},
				]}
				chartType='kpi_card'
				xAxisKey='scope'
				xAxisType='category'
				series={[
					{
						data_key: 'fileCount',
						label: 'Files',
						color: 'var(--chart-1)',
						value_format: COUNT_VALUE_FORMAT,
					},
					{
						data_key: 'totalBytes',
						label: 'Size occupied',
						color: 'var(--chart-2)',
						value_format: BYTES_VALUE_FORMAT,
					},
				]}
			/>
		</UsageState>
	);
}

function UsageState({
	query,
	isEmpty,
	children,
}: {
	query: StorageUsageQuery;
	isEmpty: boolean;
	children: React.ReactNode;
}) {
	if (query.isError) {
		return <p className='py-6 text-center text-sm text-destructive'>Failed to load storage usage.</p>;
	}

	if (query.isPending) {
		return <p className='py-6 text-center text-sm text-muted-foreground'>Measuring storage usage…</p>;
	}

	if (isEmpty) {
		return <p className='py-6 text-center text-sm text-muted-foreground'>No files stored yet.</p>;
	}

	return <>{children}</>;
}

const BACKEND_LABELS: Record<StorageBackend, string> = {
	none: 'Disabled',
	local: 'Local directory',
	s3: 'S3-compatible bucket',
};

function BackendIcon({ backend }: { backend: StorageBackend }) {
	if (backend === 'none') {
		return <Ban className='size-3.5' />;
	}
	return backend === 's3' ? <Cloud className='size-3.5' /> : <HardDrive className='size-3.5' />;
}

function DisabledNotice({ children }: { children: React.ReactNode }) {
	return (
		<div className='flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30'>
			<div className='shrink-0 rounded-full p-2 bg-muted text-muted-foreground'>
				<Ban className='size-4' />
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<span className='font-semibold text-foreground'>Permanent storage is off</span>
				<p className='text-sm text-muted-foreground'>{children}</p>
			</div>
		</div>
	);
}

function SharedVolumeNotice() {
	return (
		<div className='flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30'>
			<div className='shrink-0 rounded-full p-2 bg-muted text-muted-foreground'>
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
