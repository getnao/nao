import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link as LinkIcon, Loader2 } from 'lucide-react';
import type { Visibility } from '@nao/shared/types';
import {
	hasAccessChanges,
	ManageShareFooter,
	MemberPicker,
	ShareLoadingDialog,
	VisibilityPicker,
	VisibilitySummary,
} from '@/components/share-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { useMemberPicker, useCopyWithFeedback } from '@/hooks/use-share-dialog';

interface ShareStoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	storyId: string;
}

export function ShareStoryDialog({ open, onOpenChange, chatId, storyId }: ShareStoryDialogProps) {
	const shareQuery = useQuery(trpc.storyShare.findByStory.queryOptions({ chatId, storyId }));
	const shareData = shareQuery.data;
	const isShared = !!shareData?.shareId;

	if (shareQuery.isLoading && !shareData) {
		return <ShareLoadingDialog open={open} onOpenChange={onOpenChange} title='Share Story' />;
	}

	if (!isShared) {
		return <CreateShareDialog open={open} onOpenChange={onOpenChange} chatId={chatId} storyId={storyId} />;
	}

	return (
		<ManageShareDialog
			open={open}
			onOpenChange={onOpenChange}
			chatId={chatId}
			storyId={storyId}
			shareId={shareData.shareId}
			visibility={shareData.visibility as Visibility}
			allowedUserIds={shareData.allowedUserIds}
		/>
	);
}

function useInvalidateShareQueries(chatId: string, storyId: string) {
	const queryClient = useQueryClient();
	return useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.findByStory.queryKey({ chatId, storyId }) });
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
	}, [queryClient, chatId, storyId]);
}

function CreateShareDialog({ open, onOpenChange, chatId, storyId }: ShareStoryDialogProps) {
	const { data: session } = useSession();
	const [visibility, setVisibility] = useState<Visibility>('project');
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const invalidateShareQueries = useInvalidateShareQueries(chatId, storyId);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const currentUserId = session?.user?.id;
	const { selectedUserIds, search, setSearch, filteredMembers, toggleUser, membersQuery, reset } =
		useMemberPicker(currentUserId);

	useEffect(() => {
		if (open) {
			setVisibility('project');
			reset();
			setIsCopied(false);
		}
	}, [open, reset]);

	const shareMutation = useMutation(
		trpc.storyShare.create.mutationOptions({
			onSuccess: (data) => {
				invalidateShareQueries();
				const url = `${window.location.origin}/stories/shared/${data.id}`;
				navigator.clipboard.writeText(url);
				setIsCopied(true);
				clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => {
					setIsCopied(false);
					onOpenChange(false);
				}, 1500);
			},
		}),
	);

	const handleShare = useCallback(() => {
		shareMutation.mutate({
			chatId,
			storyId,
			visibility,
			allowedUserIds: visibility === 'specific' ? [...selectedUserIds] : undefined,
		});
	}, [chatId, storyId, visibility, selectedUserIds, shareMutation]);

	const canShare = visibility === 'project' || selectedUserIds.size > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Share Story</DialogTitle>
					<DialogDescription>
						Share a link to this story. Recipients will always see the latest version.
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					<VisibilityPicker visibility={visibility} onChange={setVisibility} />
					{visibility === 'specific' && (
						<MemberPicker
							members={filteredMembers}
							selectedUserIds={selectedUserIds}
							isLoading={membersQuery.isLoading}
							search={search}
							onSearchChange={setSearch}
							onToggleUser={toggleUser}
						/>
					)}
				</div>

				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleShare} disabled={!canShare || shareMutation.isPending} className='gap-1.5'>
						{shareMutation.isPending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : isCopied ? (
							<Check className='size-3.5' />
						) : (
							<LinkIcon className='size-3.5' />
						)}
						<span>{isCopied ? 'Link copied!' : 'Share & copy link'}</span>
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
	storyId,
	shareId,
	visibility,
	allowedUserIds,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	storyId: string;
	shareId: string;
	visibility: Visibility;
	allowedUserIds: string[];
}) {
	const { data: session } = useSession();
	const { isCopied, copy: copyLink } = useCopyWithFeedback();
	const invalidateShareQueries = useInvalidateShareQueries(chatId, storyId);

	const currentUserId = session?.user?.id;
	const { selectedUserIds, search, setSearch, filteredMembers, toggleUser, membersQuery, reset } = useMemberPicker(
		currentUserId,
		allowedUserIds,
	);

	useEffect(() => {
		if (open) {
			reset(allowedUserIds);
		}
	}, [open, allowedUserIds, reset]);

	const hasChanges = useMemo(
		() => hasAccessChanges(visibility, allowedUserIds, selectedUserIds),
		[visibility, allowedUserIds, selectedUserIds],
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
		deleteMutation.mutate({ id: shareId });
	}, [shareId, deleteMutation]);

	const handleSaveAccess = useCallback(() => {
		updateAccessMutation.mutate({ id: shareId, allowedUserIds: [...selectedUserIds] });
	}, [shareId, selectedUserIds, updateAccessMutation]);

	const isBusy = deleteMutation.isPending || updateAccessMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Sharing Settings</DialogTitle>
					<DialogDescription>
						This story is currently shared. Recipients always see the latest version.
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					<VisibilitySummary visibility={visibility} selectedUserIds={selectedUserIds} itemLabel='story' />
					{visibility === 'specific' && (
						<MemberPicker
							members={filteredMembers}
							selectedUserIds={selectedUserIds}
							isLoading={membersQuery.isLoading}
							search={search}
							onSearchChange={setSearch}
							onToggleUser={toggleUser}
						/>
					)}
				</div>

				<ManageShareFooter
					isBusy={isBusy}
					hasChanges={hasChanges}
					isDeletePending={deleteMutation.isPending}
					isUpdatePending={updateAccessMutation.isPending}
					isCopied={isCopied}
					canSave={selectedUserIds.size > 0}
					onUnshare={handleUnshare}
					onSaveAccess={handleSaveAccess}
					onCopyLink={handleCopyLink}
				/>
			</DialogContent>
		</Dialog>
	);
}
