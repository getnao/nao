import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, EllipsisVertical, Shield, ShieldOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTimeAgo } from '@/hooks/use-time-ago';
import {
	canOwnAdminModeAutomation,
	setAutomationAdminMode,
	useAdminModeAutomationIds,
} from '@/lib/automation-admin-mode';
import { getAutomationTriggerLabel, isAutomationActive } from '@/lib/automation-triggers';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type ProjectAutomation = inferRouterOutputs<TrpcRouter>['automation']['listAllForAdmin'][number];
type ProjectUser = inferRouterOutputs<TrpcRouter>['project']['listUsersWithAccess'][number];
type AdminModeStatus = 'off' | 'enabled' | 'skipped';

interface AutomationRowActions {
	onTransfer: (automation: ProjectAutomation) => void;
	onDelete: (automation: ProjectAutomation) => void;
}

interface AdminModeTurnedOff {
	automationTitle: string;
	newOwner: ProjectUser;
}

export function ProjectAutomations() {
	const automations = useQuery(trpc.automation.listAllForAdmin.queryOptions());
	const users = useQuery(trpc.project.listUsersWithAccess.queryOptions());
	const [transferTarget, setTransferTarget] = useState<ProjectAutomation | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ProjectAutomation | null>(null);
	const [adminModeTurnedOff, setAdminModeTurnedOff] = useState<AdminModeTurnedOff | null>(null);
	const adminModeIds = useAdminModeAutomationIds();

	if (automations.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading automations...</div>;
	}
	if (automations.isError || !automations.data) {
		return <div className='text-sm text-destructive'>Failed to load automations.</div>;
	}

	const adminModeStatuses = getAdminModeStatuses(automations.data, adminModeIds, users.data ?? []);
	const orphanedCount = automations.data.filter((automation) => !automation.ownerHasProjectAccess).length;
	const skippedAdminModeCount = [...adminModeStatuses.values()].filter((status) => status === 'skipped').length;

	return (
		<>
			{adminModeTurnedOff && (
				<AdminModeTurnedOffNotice notice={adminModeTurnedOff} onDismiss={() => setAdminModeTurnedOff(null)} />
			)}
			{orphanedCount > 0 && <OrphanedAutomationsWarning count={orphanedCount} />}
			{skippedAdminModeCount > 0 && <SkippedAdminModeWarning count={skippedAdminModeCount} />}
			<SettingsCard
				title='All automations'
				description='Automations created by every member of this project.'
				flush
			>
				<AutomationsTable
					automations={automations.data}
					adminModeStatuses={adminModeStatuses}
					actions={{ onTransfer: setTransferTarget, onDelete: setDeleteTarget }}
				/>
			</SettingsCard>
			<TransferOwnershipDialog
				automation={transferTarget}
				adminMode={transferTarget ? adminModeIds.has(transferTarget.id) : false}
				onClose={() => setTransferTarget(null)}
				onAdminModeTurnedOff={setAdminModeTurnedOff}
			/>
			<DeleteAutomationDialog automation={deleteTarget} onClose={() => setDeleteTarget(null)} />
		</>
	);
}

function AdminModeTurnedOffNotice({ notice, onDismiss }: { notice: AdminModeTurnedOff; onDismiss: () => void }) {
	return (
		<Callout variant='warning' icon={ShieldOff} className='text-sm'>
			<div className='flex items-start justify-between gap-3'>
				<p>
					Admin mode was turned off for “{notice.automationTitle}”. {notice.newOwner.name} is{' '}
					{describeRole(notice.newOwner.role)}, so the automation now runs on the warehouse, without app-wide
					usage data.
				</p>
				<button
					type='button'
					onClick={onDismiss}
					aria-label='Dismiss'
					className='inline-flex size-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-amber-500/15'
				>
					<X className='size-3.5' />
				</button>
			</div>
		</Callout>
	);
}

function SkippedAdminModeWarning({ count }: { count: number }) {
	const message =
		count === 1
			? '1 admin mode automation is skipping its runs because its owner is no longer an admin or context admin.'
			: `${count} admin mode automations are skipping their runs because their owners are no longer admins or context admins.`;
	return (
		<Callout variant='warning' icon={Shield} className='text-sm'>
			{message} Restore the role, or transfer the automation to an admin.
		</Callout>
	);
}

function OrphanedAutomationsWarning({ count }: { count: number }) {
	const subject = count === 1 ? '1 automation belongs' : `${count} automations belong`;
	return (
		<Callout variant='warning' className='text-sm'>
			{subject} to a user who no longer has access to this project. Their runs will fail until you transfer them
			to another member or disable them.
		</Callout>
	);
}

function AutomationsTable({
	automations,
	adminModeStatuses,
	actions,
}: {
	automations: ProjectAutomation[];
	adminModeStatuses: Map<string, AdminModeStatus>;
	actions: AutomationRowActions;
}) {
	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-3xl table-fixed'>
				<TableHeader>
					<TableRow className='[&_th]:h-12'>
						<TableHead className='w-[30%]'>Automation</TableHead>
						<TableHead className='w-[26%]'>Owner</TableHead>
						<TableHead className='w-[18%]'>Last run</TableHead>
						<TableHead className='w-[18%]'>Status</TableHead>
						<TableHead className='w-[8%]' />
					</TableRow>
				</TableHeader>
				<TableBody>
					{automations.length === 0 && (
						<TableRow>
							<TableCell colSpan={5} className='h-24 text-center'>
								No automations have been created in this project.
							</TableCell>
						</TableRow>
					)}
					{automations.map((automation) => (
						<AutomationRow
							key={automation.id}
							automation={automation}
							adminModeStatus={adminModeStatuses.get(automation.id) ?? 'off'}
							actions={actions}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function AutomationRow({
	automation,
	adminModeStatus,
	actions,
}: {
	automation: ProjectAutomation;
	adminModeStatus: AdminModeStatus;
	actions: AutomationRowActions;
}) {
	return (
		<TableRow>
			<TableCell className='min-w-0 overflow-hidden'>
				<div className='flex min-w-0 flex-col'>
					<div className='flex min-w-0 items-center gap-1.5'>
						<span className='truncate font-medium' title={automation.title}>
							{automation.title}
						</span>
						{adminModeStatus !== 'off' && <AdminModeBadge isSkipped={adminModeStatus === 'skipped'} />}
					</div>
					<span className='truncate text-xs text-muted-foreground'>
						{getAutomationTriggerLabel(automation)}
					</span>
				</div>
			</TableCell>
			<TableCell className='min-w-0 overflow-hidden'>
				<AutomationOwner automation={automation} />
			</TableCell>
			<TableCell className='min-w-0 overflow-hidden'>
				<LastRun status={automation.lastRunStatus} startedAt={automation.lastRunStartedAt} />
			</TableCell>
			<TableCell>
				<AutomationEnabledSwitch automation={automation} />
			</TableCell>
			<TableCell className='text-right'>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant='ghost' size='icon-sm' aria-label={`Actions for ${automation.title}`}>
							<EllipsisVertical className='size-4' />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end'>
						<DropdownMenuGroup>
							<DropdownMenuItem onSelect={() => actions.onTransfer(automation)}>
								Transfer ownership
							</DropdownMenuItem>
							<DropdownMenuItem
								className='text-destructive'
								onSelect={() => actions.onDelete(automation)}
							>
								Delete
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</TableCell>
		</TableRow>
	);
}

function AdminModeBadge({ isSkipped }: { isSkipped: boolean }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant='context_admin'
					className={cn('shrink-0', isSkipped && 'border-amber-500/40 bg-amber-500/15')}
				>
					{isSkipped ? <AlertTriangle /> : <Shield />}
					{isSkipped ? 'Admin · skipped' : 'Admin'}
				</Badge>
			</TooltipTrigger>
			<TooltipContent className='max-w-64'>
				{isSkipped
					? 'Runs in admin mode, but its owner is no longer an admin or context admin, so runs are skipped.'
					: 'Runs in admin mode: it can query app-wide usage data.'}
			</TooltipContent>
		</Tooltip>
	);
}

function AutomationOwner({ automation }: { automation: ProjectAutomation }) {
	const { owner, ownerHasProjectAccess } = automation;
	return (
		<div className='flex min-w-0 flex-col gap-0.5'>
			<div className='flex min-w-0 items-center gap-1.5'>
				<span className='truncate font-medium' title={owner?.name}>
					{owner?.name ?? 'Deleted user'}
				</span>
				{!ownerHasProjectAccess && <OrphanedOwnerBadge isDeleted={!owner} />}
			</div>
			{owner && (
				<span className='truncate text-xs text-muted-foreground' title={owner.email}>
					{owner.email}
				</span>
			)}
		</div>
	);
}

function OrphanedOwnerBadge({ isDeleted }: { isDeleted: boolean }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant='error' className='shrink-0'>
					<AlertTriangle />
					{isDeleted ? 'Deleted' : 'Removed'}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				{isDeleted ? 'This user no longer exists.' : 'This user no longer has access to this project.'} Runs
				will fail until the automation is transferred.
			</TooltipContent>
		</Tooltip>
	);
}

function LastRun({ status, startedAt }: { status: ProjectAutomation['lastRunStatus']; startedAt: Date | null }) {
	const timeAgo = useTimeAgo(startedAt ? new Date(startedAt).getTime() : 0);
	if (!status || !startedAt) {
		return <span className='text-xs text-muted-foreground'>Never run</span>;
	}
	return (
		<div className='flex min-w-0 flex-col items-start gap-0.5'>
			<Badge variant={status === 'failed' ? 'error' : 'secondary'} className='capitalize'>
				{status}
			</Badge>
			<span className='text-xs text-muted-foreground' title={new Date(startedAt).toLocaleString()}>
				{timeAgo.humanReadable}
			</span>
		</div>
	);
}

function AutomationEnabledSwitch({ automation }: { automation: ProjectAutomation }) {
	const queryClient = useQueryClient();
	const setEnabled = useMutation(
		trpc.automation.setEnabledAsAdmin.mutationOptions({
			onSuccess: () => invalidateAutomationQueries(queryClient),
		}),
	);
	const isActive = isAutomationActive(automation);

	return (
		<div className='flex min-w-0 flex-col gap-1'>
			<div className='flex items-center gap-2'>
				<Switch
					checked={isActive}
					disabled={setEnabled.isPending}
					aria-label={`${isActive ? 'Disable' : 'Enable'} ${automation.title}`}
					onCheckedChange={(enabled) => setEnabled.mutate({ id: automation.id, enabled })}
				/>
				<span className='text-sm text-muted-foreground'>{isActive ? 'Enabled' : 'Disabled'}</span>
			</div>
			{setEnabled.error && (
				<p className='text-xs text-destructive' role='alert'>
					{setEnabled.error.message}
				</p>
			)}
		</div>
	);
}

function TransferOwnershipDialog({
	automation,
	adminMode,
	onClose,
	onAdminModeTurnedOff,
}: {
	automation: ProjectAutomation | null;
	adminMode: boolean;
	onClose: () => void;
	onAdminModeTurnedOff: (notice: AdminModeTurnedOff) => void;
}) {
	const queryClient = useQueryClient();
	const users = useQuery({ ...trpc.project.listUsersWithAccess.queryOptions(), enabled: automation !== null });
	const transfer = useMutation(trpc.automation.transferOwnership.mutationOptions());
	const [newOwnerId, setNewOwnerId] = useState('');
	const candidates = getTransferCandidates(users.data ?? [], automation);
	const newOwner = candidates.find((user) => user.id === newOwnerId);
	const turnsOffAdminMode = adminMode && newOwner !== undefined && !canOwnAdminModeAutomation(newOwner.role);

	useEffect(() => {
		setNewOwnerId('');
		transfer.reset();
	}, [automation]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleOpenChange = (open: boolean) => {
		if (!open && !transfer.isPending) {
			onClose();
		}
	};

	const handleTransfer = async () => {
		if (!automation || !newOwnerId) {
			return;
		}
		await transfer.mutateAsync({ id: automation.id, newOwnerId });
		if (turnsOffAdminMode) {
			setAutomationAdminMode(automation.id, false);
			onAdminModeTurnedOff({ automationTitle: automation.title, newOwner });
		}
		await invalidateAutomationQueries(queryClient);
		onClose();
	};

	return (
		<Dialog open={automation !== null} onOpenChange={handleOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Transfer ownership</DialogTitle>
					<DialogDescription>
						Choose who will own “{automation?.title}”. Future runs will use the new owner's access and
						integrations, and they will see the past runs.
					</DialogDescription>
				</DialogHeader>
				<div className='grid gap-2'>
					<label htmlFor='transfer-automation-owner' className='text-sm font-medium'>
						New owner
					</label>
					<Select value={newOwnerId} onValueChange={setNewOwnerId}>
						<SelectTrigger id='transfer-automation-owner' size='input' disabled={users.isLoading}>
							<SelectValue placeholder={users.isLoading ? 'Loading members...' : 'Select a member'} />
						</SelectTrigger>
						<SelectContent>
							{candidates.map((user) => (
								<SelectItem key={user.id} value={user.id}>
									{user.name} · {user.email}
									{adminMode && !canOwnAdminModeAutomation(user.role) && (
										<span className='text-xs text-muted-foreground'>· {formatRole(user.role)}</span>
									)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{adminMode && !turnsOffAdminMode && (
					<Callout icon={Shield} className='text-xs'>
						This automation runs in admin mode. It stays on only if the new owner is an admin or context
						admin.
					</Callout>
				)}
				{turnsOffAdminMode && (
					<Callout variant='warning' icon={ShieldOff} className='text-xs'>
						<span className='font-medium'>Admin mode will be turned off.</span> {newOwner.name} is{' '}
						{describeRole(newOwner.role)}, so the automation will run on the warehouse and stop reading
						app-wide usage data.
					</Callout>
				)}
				{transfer.error && (
					<p className='text-sm text-destructive' role='alert'>
						{transfer.error.message}
					</p>
				)}
				<div className='flex justify-end gap-2'>
					<Button variant='ghost' size='sm' disabled={transfer.isPending} onClick={onClose}>
						Cancel
					</Button>
					<Button
						size='sm'
						disabled={!newOwnerId || transfer.isPending}
						isLoading={transfer.isPending}
						onClick={handleTransfer}
					>
						{turnsOffAdminMode ? 'Transfer and turn off admin mode' : 'Transfer'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function DeleteAutomationDialog({
	automation,
	onClose,
}: {
	automation: ProjectAutomation | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const deleteAutomation = useMutation(trpc.automation.deleteAsAdmin.mutationOptions());

	useEffect(() => {
		deleteAutomation.reset();
	}, [automation]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleDelete = async () => {
		if (!automation) {
			return;
		}
		await deleteAutomation.mutateAsync({ id: automation.id });
		await invalidateAutomationQueries(queryClient);
		onClose();
	};

	return (
		<ConfirmationDialog
			open={automation !== null}
			onOpenChange={(open) => !open && onClose()}
			title={`Delete “${automation?.title ?? ''}”?`}
			description='This permanently deletes the automation and all of its past runs for its owner. This cannot be undone.'
			confirmLabel='Delete'
			onConfirm={handleDelete}
			isPending={deleteAutomation.isPending}
			preventCloseWhilePending
			error={deleteAutomation.error?.message}
		/>
	);
}

/** Admin actions can change the current admin's own automations, so the sidebar, feed and badges refresh too. */
function invalidateAutomationQueries(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: trpc.automation.pathKey() });
}

function getAdminModeStatuses(
	automations: ProjectAutomation[],
	adminModeIds: ReadonlySet<string>,
	users: ProjectUser[],
): Map<string, AdminModeStatus> {
	const roles = new Map(users.map((user) => [user.id, user.role]));
	return new Map(
		automations.map((automation) => [automation.id, getAdminModeStatus(automation, adminModeIds, roles)]),
	);
}

function getAdminModeStatus(
	automation: ProjectAutomation,
	adminModeIds: ReadonlySet<string>,
	roles: Map<string, ProjectUser['role']>,
): AdminModeStatus {
	if (!adminModeIds.has(automation.id)) {
		return 'off';
	}
	const ownerRole = automation.owner ? roles.get(automation.owner.id) : undefined;
	const isOwnerDemoted = ownerRole !== undefined && !canOwnAdminModeAutomation(ownerRole);
	return isOwnerDemoted ? 'skipped' : 'enabled';
}

function describeRole(role: ProjectUser['role']): string {
	return role === 'viewer' ? 'a viewer' : 'a user';
}

function formatRole(role: ProjectUser['role']): string {
	return role === 'viewer' ? 'Viewer' : 'User';
}

function getTransferCandidates(users: ProjectUser[], automation: ProjectAutomation | null): ProjectUser[] {
	return users
		.filter((user) => user.role !== 'viewer' && user.id !== automation?.owner?.id)
		.sort((a, b) => a.name.localeCompare(b.name));
}
