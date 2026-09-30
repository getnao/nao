import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link as LinkIcon, Loader2, Pin } from 'lucide-react';
import type { Visibility } from '@nao/shared/types';
import {
	hasAccessChanges,
	ManageShareFooter,
	MemberPicker,
	NotifyPeopleToggle,
	ShareLoadingDialog,
	VisibilityPicker,
	VisibilitySummary,
} from '@/components/share-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { useGroupPicker, useMemberPicker, useCopyWithFeedback } from '@/hooks/use-share-dialog';

export type ShareStoryIntent = 'share' | 'pin';

const SHARE_STORY_DIALOG_WIDTH = 'sm:max-w-lg';

interface ShareStoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	storySlug: string;
	intent?: ShareStoryIntent;
}

export function ShareStoryDialog({ open, onOpenChange, chatId, storySlug, intent = 'share' }: ShareStoryDialogProps) {
	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }));
	const shareData = shareQuery.data;
	const isShared = !!shareData?.shareId;

	if (shareQuery.isLoading && !shareData) {
		return (
			<ShareLoadingDialog
				open={open}
				onOpenChange={onOpenChange}
				title={intent === 'pin' ? 'Pin Story' : 'Share Story'}
				className={SHARE_STORY_DIALOG_WIDTH}
			/>
		);
	}

	if (!isShared) {
		return (
			<CreateShareDialog
				open={open}
				onOpenChange={onOpenChange}
				chatId={chatId}
				storySlug={storySlug}
				intent={intent}
			/>
		);
	}

	return (
		<ManageShareDialog
			open={open}
			onOpenChange={onOpenChange}
			chatId={chatId}
			storySlug={storySlug}
			shareId={shareData.shareId}
			visibility={shareData.visibility as Visibility}
			allowedUserIds={shareData.allowedUserIds}
			allowedGroupIds={shareData.allowedGroupIds}
		/>
	);
}

function useInvalidateShareQueries(chatId: string, storySlug: string) {
	const queryClient = useQueryClient();
	return useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.getSharedStoryInfo.queryKey({ chatId, storySlug }) });
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
	}, [queryClient, chatId, storySlug]);
}

function CreateShareDialog({ open, onOpenChange, chatId, storySlug, intent = 'share' }: ShareStoryDialogProps) {
	const { data: session } = useSession();
	const [visibility, setVisibility] = useState<Visibility>('project');
	const [notify, setNotify] = useState(false);
	const [isConfirmed, setIsConfirmed] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const invalidateShareQueries = useInvalidateShareQueries(chatId, storySlug);
	const isPinIntent = intent === 'pin';
	const smtpQuery = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const isSmtpEnabled = smtpQuery.data === true;

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const currentUserId = session?.user?.id;
	const { selectedUserIds, search, setSearch, filteredMembers, toggleUser, membersQuery, reset } = useMemberPicker(
		currentUserId,
		undefined,
		chatId,
	);
	const groupPicker = useGroupPicker(search, undefined);
	const { selectedGroupIds, reset: resetGroups } = groupPicker;

	useEffect(() => {
		if (open) {
			setVisibility('project');
			setNotify(false);
			reset();
			resetGroups();
			setIsConfirmed(false);
		}
	}, [open, reset, resetGroups]);

	const shareMutation = useMutation(trpc.storyShare.create.mutationOptions());

	const handleConfirm = useCallback(() => {
		const isSpecific = visibility === 'specific';
		const promise = shareMutation
			.mutateAsync({
				chatId,
				storySlug,
				visibility,
				allowedUserIds: isSpecific ? [...selectedUserIds] : undefined,
				allowedGroupIds: isSpecific ? [...selectedGroupIds] : undefined,
				pinAfterCreate: isPinIntent,
				notify: isSmtpEnabled && notify,
			})
			.then((data) => {
				invalidateShareQueries();
				setIsConfirmed(true);
				clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => {
					setIsConfirmed(false);
					onOpenChange(false);
				}, 1500);
				return data;
			});

		if (!isPinIntent) {
			const blobPromise = promise.then(
				(data) => new Blob([`${window.location.origin}/stories/shared/${data.id}`], { type: 'text/plain' }),
			);
			blobPromise.catch(() => {});
			navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]).catch(() => {});
		}

		promise.catch(() => {});
	}, [
		chatId,
		storySlug,
		visibility,
		selectedUserIds,
		selectedGroupIds,
		notify,
		isSmtpEnabled,
		shareMutation,
		invalidateShareQueries,
		onOpenChange,
		isPinIntent,
	]);

	const canConfirm = visibility === 'project' || selectedUserIds.size > 0 || selectedGroupIds.size > 0;

	const title = isPinIntent ? 'Pin Story' : 'Share Story';
	const description = isPinIntent
		? "Pinning surfaces a story on the project's homepage. Choose who should see it — pinning requires sharing first."
		: 'Share a link to this story. Recipients will always see the latest version.';
	const confirmIdleIcon = isPinIntent ? <Pin className='size-3.5 fill-current' /> : <LinkIcon className='size-3.5' />;
	const confirmIdleLabel = isPinIntent ? 'Share & pin' : 'Share & copy link';
	const confirmDoneLabel = isPinIntent ? 'Pinned!' : 'Link copied!';

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={SHARE_STORY_DIALOG_WIDTH}>
				<DialogHeader className='gap-4'>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className='font-medium'>{description}</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					{isPinIntent && (
						<div className='rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>
							Once shared, this story will be pinned for the selected audience.
						</div>
					)}
					<VisibilityPicker
						visibility={visibility}
						onChange={setVisibility}
						specificLabel='People & groups'
					/>
					{isSmtpEnabled && (
						<NotifyPeopleToggle checked={notify} onCheckedChange={setNotify} itemLabel='story' />
					)}
					{visibility === 'specific' && (
						<MemberPicker
							members={filteredMembers}
							selectedUserIds={selectedUserIds}
							isLoading={membersQuery.isLoading || groupPicker.groupsQuery.isLoading}
							search={search}
							onSearchChange={setSearch}
							onToggleUser={toggleUser}
							groups={groupPicker.filteredGroups}
							selectedGroupIds={selectedGroupIds}
							onToggleGroup={groupPicker.toggleGroup}
						/>
					)}
				</div>

				<div className='flex justify-end gap-2'>
					<Button variant='outline' className='rounded-full' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						className='gap-1.5 rounded-full'
						onClick={handleConfirm}
						disabled={!canConfirm || shareMutation.isPending}
					>
						{shareMutation.isPending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : isConfirmed ? (
							<Check className='size-3.5' />
						) : (
							confirmIdleIcon
						)}
						<span>{isConfirmed ? confirmDoneLabel : confirmIdleLabel}</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ManageShareDialog({
	open,
	onOpenChange,
	chatId,
	storySlug,
	shareId,
	visibility,
	allowedUserIds,
	allowedGroupIds,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	storySlug: string;
	shareId: string;
	visibility: Visibility;
	allowedUserIds: string[];
	allowedGroupIds: string[];
}) {
	const { data: session } = useSession();
	const { isCopied, copy: copyLink } = useCopyWithFeedback();
	const invalidateShareQueries = useInvalidateShareQueries(chatId, storySlug);

	const currentUserId = session?.user?.id;
	const { selectedUserIds, search, setSearch, filteredMembers, toggleUser, membersQuery, reset } = useMemberPicker(
		currentUserId,
		allowedUserIds,
		chatId,
	);
	const groupPicker = useGroupPicker(search, allowedGroupIds);
	const { selectedGroupIds, reset: resetGroups } = groupPicker;

	const stableAllowedUserIds = useMemo(
		() => allowedUserIds,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[allowedUserIds.join(',')],
	);
	const stableAllowedGroupIds = useMemo(
		() => allowedGroupIds,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[allowedGroupIds.join(',')],
	);

	useEffect(() => {
		if (open) {
			reset(stableAllowedUserIds);
			resetGroups(stableAllowedGroupIds);
		}
	}, [open, stableAllowedUserIds, stableAllowedGroupIds, reset, resetGroups]);

	const hasChanges = useMemo(
		() => hasAccessChanges(visibility, allowedUserIds, selectedUserIds, allowedGroupIds, selectedGroupIds),
		[visibility, allowedUserIds, selectedUserIds, allowedGroupIds, selectedGroupIds],
	);

	const deleteMutation = useMutation(
		trpc.storyShare.delete.mutationOptions({
			onSuccess: () => {
				invalidateShareQueries();
				onOpenChange(false);
			},
		}),
	);

	const updateAccessMutation = useMutation(
		trpc.storyShare.updateAccess.mutationOptions({
			onSuccess: () => {
				invalidateShareQueries();
				onOpenChange(false);
			},
		}),
	);

	const handleCopyLink = useCallback(() => {
		copyLink(`${window.location.origin}/stories/shared/${shareId}`);
	}, [copyLink, shareId]);

	const handleUnshare = useCallback(() => {
		deleteMutation.mutate({ shareId });
	}, [shareId, deleteMutation]);

	const handleSaveAccess = useCallback(() => {
		updateAccessMutation.mutate({
			shareId,
			allowedUserIds: [...selectedUserIds],
			allowedGroupIds: [...selectedGroupIds],
		});
	}, [shareId, selectedUserIds, selectedGroupIds, updateAccessMutation]);

	const isBusy = deleteMutation.isPending || updateAccessMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={SHARE_STORY_DIALOG_WIDTH}>
				<DialogHeader className='gap-4'>
					<DialogTitle>Sharing Settings</DialogTitle>
					<DialogDescription className='font-medium'>
						This story is currently shared. Recipients always see the latest version.
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					<VisibilitySummary
						visibility={visibility}
						selectedUserIds={selectedUserIds}
						selectedGroupIds={selectedGroupIds}
						itemLabel='story'
					/>
					{visibility === 'specific' && (
						<MemberPicker
							members={filteredMembers}
							selectedUserIds={selectedUserIds}
							isLoading={membersQuery.isLoading || groupPicker.groupsQuery.isLoading}
							search={search}
							onSearchChange={setSearch}
							onToggleUser={toggleUser}
							groups={groupPicker.filteredGroups}
							selectedGroupIds={selectedGroupIds}
							onToggleGroup={groupPicker.toggleGroup}
						/>
					)}
				</div>

				<ManageShareFooter
					isBusy={isBusy}
					hasChanges={hasChanges}
					isDeletePending={deleteMutation.isPending}
					isUpdatePending={updateAccessMutation.isPending}
					isCopied={isCopied}
					canSave={selectedUserIds.size > 0 || selectedGroupIds.size > 0}
					onUnshare={handleUnshare}
					onSaveAccess={handleSaveAccess}
					onCopyLink={handleCopyLink}
				/>
			</DialogContent>
		</Dialog>
	);
}
