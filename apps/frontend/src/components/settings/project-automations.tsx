import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, EllipsisVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { trpc } from '@/main';

type ProjectAutomation = inferRouterOutputs<TrpcRouter>['automation']['listAllForAdmin'][number];
type ProjectUser = inferRouterOutputs<TrpcRouter>['project']['listUsersWithAccess'][number];

interface AutomationRowActions {
	onTransfer: (automation: ProjectAutomation) => void;
	onDelete: (automation: ProjectAutomation) => void;
}

export function ProjectAutomations() {
	const automations = useQuery(trpc.automation.listAllForAdmin.queryOptions());
	const [transferTarget, setTransferTarget] = useState<ProjectAutomation | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ProjectAutomation | null>(null);

	if (automations.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading automations...</div>;
	}
	if (automations.isError || !automations.data) {
		return <div className='text-sm text-destructive'>Failed to load automations.</div>;
	}

	const orphanedCount = automations.data.filter((automation) => !automation.ownerHasProjectAccess).length;

	return (
		<>
			{orphanedCount > 0 && <OrphanedAutomationsWarning count={orphanedCount} />}
			<SettingsCard
				title='All automations'
				description='Automations created by every member of this project.'
				flush
			>
				<AutomationsTable
					automations={automations.data}
					actions={{ onTransfer: setTransferTarget, onDelete: setDeleteTarget }}
				/>
			</SettingsCard>
			<TransferOwnershipDialog automation={transferTarget} onClose={() => setTransferTarget(null)} />
			<DeleteAutomationDialog automation={deleteTarget} onClose={() => setDeleteTarget(null)} />
		</>
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
	actions,
}: {
	automations: ProjectAutomation[];
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
						<AutomationRow key={automation.id} automation={automation} actions={actions} />
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function AutomationRow({ automation, actions }: { automation: ProjectAutomation; actions: AutomationRowActions }) {
	return (
		<TableRow>
			<TableCell className='min-w-0 overflow-hidden'>
				<div className='flex min-w-0 flex-col'>
					<span className='truncate font-medium' title={automation.title}>
						{automation.title}
					</span>
					<span className='truncate text-xs text-muted-foreground'>{getTriggerLabel(automation)}</span>
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
			onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.automation.listAllForAdmin.queryKey() }),
		}),
	);
	const isActive = isAutomationActive(automation);

	return (
		<div className='flex items-center gap-2'>
			<Switch
				checked={isActive}
				disabled={setEnabled.isPending}
				aria-label={`${isActive ? 'Disable' : 'Enable'} ${automation.title}`}
				onCheckedChange={(enabled) => setEnabled.mutate({ id: automation.id, enabled })}
			/>
			<span className='text-sm text-muted-foreground'>{isActive ? 'Enabled' : 'Disabled'}</span>
		</div>
	);
}

function TransferOwnershipDialog({
	automation,
	onClose,
}: {
	automation: ProjectAutomation | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const users = useQuery({ ...trpc.project.listUsersWithAccess.queryOptions(), enabled: automation !== null });
	const transfer = useMutation(trpc.automation.transferOwnership.mutationOptions());
	const [newOwnerId, setNewOwnerId] = useState('');
	const candidates = getTransferCandidates(users.data ?? [], automation);

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
		await queryClient.invalidateQueries({ queryKey: trpc.automation.listAllForAdmin.queryKey() });
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
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
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
						Transfer
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
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.automation.listAllForAdmin.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() }),
		]);
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

function getTransferCandidates(users: ProjectUser[], automation: ProjectAutomation | null): ProjectUser[] {
	return users
		.filter((user) => user.role !== 'viewer' && user.id !== automation?.owner?.id)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function isAutomationActive(automation: ProjectAutomation): boolean {
	return automation.cron ? automation.enabled : automation.webhookEnabled;
}

function getTriggerLabel(automation: ProjectAutomation): string {
	if (automation.cron) {
		const scheduleText = automation.scheduleDescription || automation.cron;
		return automation.webhookEnabled ? `${scheduleText} · webhook` : scheduleText;
	}
	return 'Triggered by webhook';
}
