import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Loader2, Users, Link as LinkIcon, Unlink } from 'lucide-react';
import type { Visibility } from '@/components/share-dialog';
import { hasAccessChanges, MemberPicker, VisibilityOption } from '@/components/share-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { useMemberPicker, useCopyWithFeedback } from '@/hooks/use-share-dialog';

interface ShareChatDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
}

export function ShareChatDialog({ open, onOpenChange, chatId }: ShareChatDialogProps) {
	const shareQuery = useQuery(trpc.sharedChat.getShareOptionsByChatId.queryOptions({ chatId }));
	const shareData = shareQuery.data;
	const isShared = !!shareData?.shareId;

	if (shareQuery.isLoading && !shareData) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle>Share Chat</DialogTitle>
						<DialogDescription>Loading sharing settings...</DialogDescription>
					</DialogHeader>
					<div className='flex items-center justify-center py-6'>
						<Loader2 className='size-4 animate-spin text-muted-foreground' />
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	if (shareQuery.isError) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle>Share Chat</DialogTitle>
						<DialogDescription className='text-destructive'>
							Failed to load sharing settings. Please try again.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant='outline' onClick={() => onOpenChange(false)}>
							Close
						</Button>
						<Button onClick={() => shareQuery.refetch()}>Retry</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	if (!isShared) {
		return <CreateShareDialog open={open} onOpenChange={onOpenChange} chatId={chatId} />;
	}

	return (
		<ManageShareDialog
			open={open}
			onOpenChange={onOpenChange}
			chatId={chatId}
			shareId={shareData.shareId}
			visibility={shareData.visibility as Visibility}
			allowedUserIds={shareData.allowedUserIds}
		/>
	);
}

function useInvalidateShareQueries(chatId: string) {
	const queryClient = useQueryClient();
	return useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.sharedChat.getShareOptionsByChatId.queryKey({ chatId }) });
		queryClient.invalidateQueries({ queryKey: trpc.sharedChat.list.queryKey() });
	}, [queryClient, chatId]);
}

function CreateShareDialog({ open, onOpenChange, chatId }: ShareChatDialogProps) {
	const { data: session } = useSession();
	const [visibility, setVisibility] = useState<Visibility>('project');
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const invalidateShareQueries = useInvalidateShareQueries(chatId);

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
		trpc.sharedChat.create.mutationOptions({
			onSuccess: (data) => {
				invalidateShareQueries();
				const url = `${window.location.origin}/shared-chat/${data.id}`;
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
			visibility,
			allowedUserIds: visibility === 'specific' ? [...selectedUserIds] : undefined,
		});
	}, [chatId, visibility, selectedUserIds, shareMutation]);

	const canShare = visibility === 'project' || selectedUserIds.size > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Share Chat</DialogTitle>
					<DialogDescription>Share a link to this chat with your team.</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					<div className='flex gap-2'>
						<VisibilityOption
							active={visibility === 'project'}
							icon={<Globe className='size-4' />}
							label='Entire project'
							description='All project members'
							onClick={() => setVisibility('project')}
						/>
						<VisibilityOption
							active={visibility === 'specific'}
							icon={<Users className='size-4' />}
							label='Specific people'
							description='Choose who can view'
							onClick={() => setVisibility('specific')}
						/>
					</div>

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

				<DialogFooter>
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
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ManageShareDialog({
	open,
	onOpenChange,
	chatId,
	shareId,
	visibility,
	allowedUserIds,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	shareId: string;
	visibility: Visibility;
	allowedUserIds: string[];
}) {
	const { data: session } = useSession();
	const { isCopied, copy: copyLink } = useCopyWithFeedback();
	const invalidateShareQueries = useInvalidateShareQueries(chatId);

	const currentUserId = session?.user?.id;
	const { selectedUserIds, search, setSearch, filteredMembers, toggleUser, membersQuery, reset } = useMemberPicker(
		currentUserId,
		allowedUserIds,
	);

	const stableAllowedUserIds = useMemo(
		() => allowedUserIds,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[allowedUserIds.join(',')],
	);

	useEffect(() => {
		if (open) {
			reset(stableAllowedUserIds);
		}
	}, [open, stableAllowedUserIds, reset]);

	const hasChanges = useMemo(
		() => hasAccessChanges(visibility, allowedUserIds, selectedUserIds),
		[visibility, allowedUserIds, selectedUserIds],
	);

	const deleteMutation = useMutation(
		trpc.sharedChat.delete.mutationOptions({
			onSuccess: () => {
				invalidateShareQueries();
				onOpenChange(false);
			},
		}),
	);

	const updateAccessMutation = useMutation(
		trpc.sharedChat.updateAccess.mutationOptions({
			onSuccess: () => {
				invalidateShareQueries();
				onOpenChange(false);
			},
		}),
	);

	const handleCopyLink = useCallback(() => {
		copyLink(`${window.location.origin}/shared-chat/${shareId}`);
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
					<DialogDescription>This chat is currently shared with your team.</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-4'>
					<div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-3'>
						{visibility === 'project' ? (
							<>
								<div className='flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600'>
									<Globe className='size-4' />
								</div>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>Shared with entire project</p>
									<p className='text-xs text-muted-foreground'>
										All project members can view this chat
									</p>
								</div>
							</>
						) : (
							<>
								<div className='flex size-8 items-center justify-center rounded-full bg-blue-100 text-blue-600'>
									<Users className='size-4' />
								</div>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>
										Shared with {selectedUserIds.size}{' '}
										{selectedUserIds.size === 1 ? 'person' : 'people'}
									</p>
									<p className='text-xs text-muted-foreground'>
										Only selected members can view this chat
									</p>
								</div>
							</>
						)}
					</div>

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

				<DialogFooter className='flex-row sm:justify-between'>
					<Button
						variant='outline'
						onClick={handleUnshare}
						disabled={isBusy}
						className='gap-1.5 text-destructive hover:text-destructive'
					>
						{deleteMutation.isPending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : (
							<Unlink className='size-3.5' />
						)}
						<span>Unshare</span>
					</Button>
					<div className='flex items-center gap-2'>
						{hasChanges && (
							<Button
								onClick={handleSaveAccess}
								disabled={isBusy || selectedUserIds.size === 0}
								className='gap-1.5'
							>
								{updateAccessMutation.isPending ? (
									<Loader2 className='size-3.5 animate-spin' />
								) : (
									<Check className='size-3.5' />
								)}
								<span>Save</span>
							</Button>
						)}
						<Button variant='outline' onClick={handleCopyLink} className='gap-1.5'>
							{isCopied ? <Check className='size-3.5' /> : <LinkIcon className='size-3.5' />}
							<span>{isCopied ? 'Copied!' : 'Copy link'}</span>
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
