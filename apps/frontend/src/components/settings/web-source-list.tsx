import { Link } from '@tanstack/react-router';
import { Archive, Play, Plus } from 'lucide-react';
import { useState } from 'react';

import type { WebRobotListItem } from '@/components/settings/web-source-recipe';
import { formatDateTime, isActiveWebRobotRun, webRobotRunBadgeVariant } from '@/components/settings/web-source-recipe';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Empty } from '@/components/ui/empty';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function WebSourceList({
	robots,
	onRunNow,
	onSetEnabled,
	onArchive,
	runningRobotId,
	archivingRobotId,
	archiveError,
}: {
	robots: WebRobotListItem[];
	onRunNow: (robot: WebRobotListItem) => void;
	onSetEnabled: (robot: WebRobotListItem, enabled: boolean) => void;
	onArchive: (robot: WebRobotListItem) => Promise<void>;
	runningRobotId?: string | null;
	archivingRobotId?: string | null;
	archiveError?: string | null;
}) {
	const [archiveTarget, setArchiveTarget] = useState<WebRobotListItem | null>(null);

	return (
		<>
			<SettingsCard
				title='Web sources'
				description='Deterministic catalogue robots that publish queryable product datasets.'
				action={
					<Button asChild size='sm'>
						<Link to='/settings/web-sources/new'>
							<Plus className='size-3.5' />
							New source
						</Link>
					</Button>
				}
				flush
			>
				{robots.length === 0 ? (
					<Empty className='p-10'>
						No web sources yet. Create one to publish a product catalogue dataset.
					</Empty>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Schedule</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Last run</TableHead>
								<TableHead>Products</TableHead>
								<TableHead className='w-0'>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{robots.map((robot) => (
								<WebSourceRow
									key={robot.id}
									robot={robot}
									onRunNow={onRunNow}
									onSetEnabled={onSetEnabled}
									onArchive={() => setArchiveTarget(robot)}
									isRunning={runningRobotId === robot.id}
								/>
							))}
						</TableBody>
					</Table>
				)}
			</SettingsCard>

			<ConfirmationDialog
				open={archiveTarget !== null}
				onOpenChange={(open) => !open && setArchiveTarget(null)}
				title={`Archive ${archiveTarget?.name ?? 'web source'}?`}
				description='This disables its schedule and hides it from the list. Generated dataset files are preserved.'
				confirmLabel='Archive'
				isPending={Boolean(archivingRobotId)}
				error={archiveError ?? undefined}
				onConfirm={async () => {
					if (!archiveTarget) {
						return;
					}
					try {
						await onArchive(archiveTarget);
						setArchiveTarget(null);
					} catch {
						return;
					}
				}}
			/>
		</>
	);
}

function WebSourceRow({
	robot,
	onRunNow,
	onSetEnabled,
	onArchive,
	isRunning,
}: {
	robot: WebRobotListItem;
	onRunNow: (robot: WebRobotListItem) => void;
	onSetEnabled: (robot: WebRobotListItem, enabled: boolean) => void;
	onArchive: () => void;
	isRunning: boolean;
}) {
	const active = isActiveWebRobotRun(robot.lastRunStatus);
	const nextRun = robot.enabled && robot.scheduledJob?.runAt ? formatDateTime(robot.scheduledJob.runAt) : null;

	return (
		<TableRow>
			<TableCell>
				<Link
					to='/settings/web-sources/$robotId'
					params={{ robotId: robot.id }}
					className='block max-w-72 min-w-0 hover:underline'
				>
					<div className='truncate font-medium'>{robot.name}</div>
					<div className='truncate text-xs text-muted-foreground'>{robot.slug}</div>
				</Link>
			</TableCell>
			<TableCell>
				<div className='grid gap-0.5'>
					<span className='font-mono text-xs'>{robot.cron || 'Manual'}</span>
					{nextRun && <span className='text-xs text-muted-foreground'>Next: {nextRun}</span>}
				</div>
			</TableCell>
			<TableCell>
				{robot.cron ? (
					<div className='flex items-center gap-2'>
						<Switch checked={robot.enabled} onCheckedChange={(enabled) => onSetEnabled(robot, enabled)} />
						<Badge variant={robot.enabled ? 'success' : 'outline'}>
							{robot.enabled ? 'enabled' : 'paused'}
						</Badge>
					</div>
				) : (
					<Badge variant='outline'>manual</Badge>
				)}
			</TableCell>
			<TableCell>
				<div className='grid gap-1'>
					<Badge variant={webRobotRunBadgeVariant(robot.lastRunStatus)}>
						{robot.lastRunStatus ?? 'never'}
					</Badge>
					<span className='text-xs text-muted-foreground'>{formatDateTime(robot.lastRunStartedAt)}</span>
				</div>
			</TableCell>
			<TableCell>{robot.lastPublishedProductCount ?? '—'}</TableCell>
			<TableCell>
				<div className='flex justify-end gap-1'>
					<Button
						type='button'
						variant='ghost'
						size='sm'
						disabled={active || isRunning}
						isLoading={isRunning}
						onClick={() => onRunNow(robot)}
					>
						<Play className='size-3.5' />
						Run now
					</Button>
					<Button type='button' variant='ghost' size='sm' onClick={onArchive}>
						<Archive className='size-3.5' />
						Archive
					</Button>
				</div>
			</TableCell>
		</TableRow>
	);
}
