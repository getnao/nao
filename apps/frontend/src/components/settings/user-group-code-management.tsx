import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileCode2 } from 'lucide-react';
import { useState } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc, trpcClient } from '@/main';

const ADMIN_GUIDE_URL = 'https://github.com/getnao/nao/blob/main/USER_GROUPS_AS_CODE_ADMIN_GUIDE.md';
type CodeManagementPreview = inferRouterOutputs<TrpcRouter>['userGroup']['previewCodeManagement'];
type CodeManagementAction = CodeManagementPreview['groups'][number]['action'];

export function UserGroupCodeManagement() {
	const queryClient = useQueryClient();
	const status = useQuery(trpc.userGroup.managementStatus.queryOptions());
	const preview = useQuery({ ...trpc.userGroup.previewCodeManagement.queryOptions(), enabled: false });
	const [enablePreview, setEnablePreview] = useState<CodeManagementPreview | null>(null);
	const [confirmDisable, setConfirmDisable] = useState(false);
	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.userGroup.managementStatus.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.userGroup.overview.queryKey() }),
		]);
	};
	const enable = useMutation(
		trpc.userGroup.enableCodeManagement.mutationOptions({
			onSuccess: () => setEnablePreview(null),
			onSettled: invalidate,
		}),
	);
	const disable = useMutation(
		trpc.userGroup.disableCodeManagement.mutationOptions({
			onSuccess: () => setConfirmDisable(false),
			onSettled: invalidate,
		}),
	);

	if (!status.data) {
		return null;
	}
	const isCodeManaged = status.data.mode === 'code';
	const pendingEmails = status.data.pendingEmails ?? [];
	const activeFailure =
		status.data.latestFailure &&
		(!status.data.lastSuccess ||
			toTimestamp(status.data.latestFailure.completedAt) > toTimestamp(status.data.lastSuccess.completedAt))
			? status.data.latestFailure
			: null;
	const operationError = preview.error ?? enable.error ?? disable.error;
	return (
		<>
			<SettingsCard
				title='User group management'
				description={
					isCodeManaged
						? 'user_groups.yaml is the source of truth for groups, memberships, and access settings.'
						: 'Export the current state or enable user_groups.yaml after reviewing its changes.'
				}
				action={
					<div className='flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:justify-end'>
						{!isCodeManaged && (
							<Button variant='secondary' onClick={() => void downloadConfig()}>
								<Download />
								Download YAML
							</Button>
						)}
						{isCodeManaged ? (
							<Button variant='secondary' onClick={() => setConfirmDisable(true)}>
								Return to UI management
							</Button>
						) : (
							<Button
								onClick={async () => {
									const result = await preview.refetch();
									if (result.data) {
										setEnablePreview(result.data);
									}
								}}
								isLoading={preview.isFetching}
							>
								<FileCode2 />
								Preview code management
							</Button>
						)}
					</div>
				}
			>
				{(isCodeManaged || operationError) && (
					<div className='space-y-2 text-sm'>
						{isCodeManaged && (
							<p className='text-muted-foreground'>
								{status.data.lastSuccess && (
									<>
										Last synced {formatTime(status.data.lastSuccess.completedAt)} by{' '}
										{status.data.lastSuccess.actorName ??
											status.data.lastSuccess.actorEmail ??
											'Unknown user'}
										.{' '}
									</>
								)}
								<a className='underline' href={ADMIN_GUIDE_URL} target='_blank' rel='noreferrer'>
									Administrator guide
								</a>
							</p>
						)}
						{isCodeManaged && activeFailure ? (
							<p className='text-destructive'>
								Last attempt failed {formatTime(activeFailure.completedAt)}:{' '}
								{activeFailure.errorMessage ?? 'Unknown error'}
							</p>
						) : (
							operationError && <p className='text-destructive'>{operationError.message}</p>
						)}
						{pendingEmails.length > 0 && (
							<p className='text-amber-700 dark:text-amber-400'>
								Pending members: {pendingEmails.join(', ')}
							</p>
						)}
					</div>
				)}
			</SettingsCard>

			<CodeManagementPreviewDialog
				preview={enablePreview}
				onOpenChange={(open) => {
					if (!open) {
						setEnablePreview(null);
					}
				}}
				onConfirm={() => enable.mutate()}
				isPending={enable.isPending}
				error={enable.error?.message}
			/>
			<ConfirmationDialog
				open={confirmDisable}
				onOpenChange={setConfirmDisable}
				title='Return to UI management?'
				description='Current groups, settings, and resolved memberships will be preserved and become editable. SSO group mappings stay suspended.'
				confirmLabel='Return to UI management'
				onConfirm={() => disable.mutate()}
				isPending={disable.isPending}
				preventCloseWhilePending
			/>
		</>
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

function CodeManagementPreviewDialog({
	preview,
	onOpenChange,
	onConfirm,
	isPending,
	error,
}: {
	preview: CodeManagementPreview | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isPending: boolean;
	error?: string;
}) {
	const handleOpenChange = (open: boolean) => {
		if (!open && isPending) {
			return;
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={preview !== null} onOpenChange={handleOpenChange}>
			<DialogContent className='max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl'>
				<DialogHeader>
					<DialogTitle>Review code management changes</DialogTitle>
					<DialogDescription>
						These changes come from the deployed user_groups.yaml. Enabling code management makes groups and
						memberships read-only in the UI.
					</DialogDescription>
				</DialogHeader>
				{preview && <CodeManagementPreviewDetails preview={preview} />}
				<div>
					{error && <p className='mb-3 text-sm text-destructive'>{error}</p>}
					<DialogFooter>
						<Button
							variant='outline'
							className='rounded-full border'
							disabled={isPending}
							onClick={() => handleOpenChange(false)}
						>
							Cancel
						</Button>
						<Button className='rounded-full' isLoading={isPending} onClick={onConfirm}>
							Enable code management
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CodeManagementPreviewDetails({ preview }: { preview: CodeManagementPreview }) {
	const revokedShares = preview.shareRevocations.chats + preview.shareRevocations.stories;

	return (
		<div className='min-h-0 space-y-4 overflow-y-auto pr-1'>
			<section className='space-y-2' aria-labelledby='code-management-groups'>
				<h3 id='code-management-groups' className='text-sm font-medium'>
					Groups
				</h3>
				<div className='divide-y rounded-lg border'>
					{preview.groups.length > 0 ? (
						preview.groups.map((group) => (
							<div key={group.key} className='flex min-w-0 items-center justify-between gap-3 px-3 py-2'>
								<div className='min-w-0'>
									<p className='truncate text-sm font-medium'>{group.name}</p>
									<p className='truncate font-mono text-xs text-muted-foreground'>{group.key}</p>
								</div>
								<Badge variant={getActionBadgeVariant(group.action)}>
									{getActionLabel(group.action)}
								</Badge>
							</div>
						))
					) : (
						<p className='px-3 py-2 text-sm text-muted-foreground'>No custom groups in the file.</p>
					)}
				</div>
			</section>

			<section className='space-y-2' aria-labelledby='code-management-effects'>
				<h3 id='code-management-effects' className='text-sm font-medium'>
					Other effects
				</h3>
				<dl className='grid gap-2 sm:grid-cols-2'>
					<PreviewEffect label='All Users'>
						{preview.allUsersChanged ? 'Settings will change' : 'No settings changes'}
					</PreviewEffect>
					<PreviewEffect label='Access'>
						{preview.accessChanges.length > 0 ? preview.accessChanges.join(', ') : 'No access changes'}
					</PreviewEffect>
					<PreviewEffect label='Budgets'>
						{preview.budgetChanges.length > 0 ? preview.budgetChanges.join(', ') : 'No budget changes'}
					</PreviewEffect>
					<PreviewEffect label='Pending members'>
						{preview.pendingEmails.length > 0 ? preview.pendingEmails.join(', ') : 'None'}
					</PreviewEffect>
					<PreviewEffect label='Shared content'>
						{revokedShares > 0
							? `${formatRevokedShares(preview.shareRevocations)} will lose access`
							: 'No shares will lose access'}
					</PreviewEffect>
				</dl>
			</section>
		</div>
	);
}

function formatRevokedShares({ chats, stories }: { chats: number; stories: number }): string {
	return [
		chats > 0 ? `${chats} ${chats === 1 ? 'chat' : 'chats'}` : null,
		stories > 0 ? `${stories} ${stories === 1 ? 'story' : 'stories'}` : null,
	]
		.filter(Boolean)
		.join(' and ');
}

function PreviewEffect({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className='rounded-lg border bg-muted/30 p-3'>
			<dt className='text-xs font-medium text-muted-foreground'>{label}</dt>
			<dd className='mt-1 break-words text-sm'>{children}</dd>
		</div>
	);
}

function getActionLabel(action: CodeManagementAction): string {
	return {
		created: 'Create',
		adopted: 'Adopt',
		updated: 'Update',
		archived: 'Archive',
		reactivated: 'Reactivate',
		unchanged: 'Unchanged',
	}[action];
}

function getActionBadgeVariant(action: CodeManagementAction): 'success' | 'admin' | 'secondary' | 'error' | 'outline' {
	switch (action) {
		case 'created':
		case 'reactivated':
			return 'success';
		case 'adopted':
			return 'admin';
		case 'updated':
			return 'secondary';
		case 'archived':
			return 'error';
		case 'unchanged':
			return 'outline';
	}
}

function formatTime(value: Date | string | null): string {
	return value ? new Date(value).toLocaleString() : '';
}

function toTimestamp(value: Date | string | null): number {
	return value ? new Date(value).getTime() : 0;
}
