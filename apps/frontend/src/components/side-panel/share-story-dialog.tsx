import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Loader2, Users, Link as LinkIcon, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type Visibility = 'project' | 'specific';

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
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle>Share Story</DialogTitle>
						<DialogDescription>Loading sharing settings...</DialogDescription>
					</DialogHeader>
					<div className='flex items-center justify-center py-6'>
						<Loader2 className='size-4 animate-spin text-muted-foreground' />
					</div>
				</DialogContent>
			</Dialog>
		);
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

function CreateShareDialog({ open, onOpenChange, chatId, storyId }: ShareStoryDialogProps) {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const [visibility, setVisibility] = useState<Visibility>('project');
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
	const [search, setSearch] = useState('');
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const membersQuery = useQuery(trpc.project.getAllUsersWithRoles.queryOptions());
	const currentUserId = session?.user?.id;

	const otherMembers = useMemo(() => {
		return (membersQuery.data ?? []).filter((m) => m.id !== currentUserId);
	}, [membersQuery.data, currentUserId]);

	const filteredMembers = useMemo(() => {
		if (!search.trim()) {
			return otherMembers;
		}
		const q = search.toLowerCase();
		return otherMembers.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
	}, [otherMembers, search]);

	const toggleUser = useCallback((userId: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) {
				next.delete(userId);
			} else {
				next.add(userId);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (open) {
			setVisibility('project');
			setSelectedUserIds(new Set());
			setSearch('');
			setIsCopied(false);
		}
	}, [open]);

	const shareMutation = useMutation(
		trpc.storyShare.create.mutationOptions({
			onSuccess: (data) => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.findByStory.queryKey({ chatId, storyId }) });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
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
	const queryClient = useQueryClient();
	const [isCopied, setIsCopied] = useState(false);
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set(allowedUserIds));
	const [search, setSearch] = useState('');
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timeoutRef.current), []);

	const currentUserId = session?.user?.id;
	const membersQuery = useQuery(trpc.project.getAllUsersWithRoles.queryOptions());

	const otherMembers = useMemo(() => {
		return (membersQuery.data ?? []).filter((m) => m.id !== currentUserId);
	}, [membersQuery.data, currentUserId]);

	const filteredMembers = useMemo(() => {
		if (!search.trim()) {
			return otherMembers;
		}
		const q = search.toLowerCase();
		return otherMembers.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
	}, [otherMembers, search]);

	const toggleUser = useCallback((userId: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) {
				next.delete(userId);
			} else {
				next.add(userId);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		if (open) {
			setIsCopied(false);
			setSelectedUserIds(new Set(allowedUserIds));
			setSearch('');
		}
	}, [open, allowedUserIds]);

	const hasAccessChanges = useMemo(() => {
		if (visibility !== 'specific') {
			return false;
		}
		const original = new Set(allowedUserIds);
		if (original.size !== selectedUserIds.size) {
			return true;
		}
		for (const id of selectedUserIds) {
			if (!original.has(id)) {
				return true;
			}
		}
		return false;
	}, [visibility, allowedUserIds, selectedUserIds]);

	const invalidateShareQueries = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.findByStory.queryKey({ chatId, storyId }) });
		queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
	}, [queryClient, chatId, storyId]);

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
		const url = `${window.location.origin}/stories/shared/${shareId}`;
		navigator.clipboard.writeText(url);
		setIsCopied(true);
		clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => setIsCopied(false), 1500);
	}, [shareId]);

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
					<div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-3'>
						{visibility === 'project' ? (
							<>
								<div className='flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600'>
									<Globe className='size-4' />
								</div>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>Shared with entire project</p>
									<p className='text-xs text-muted-foreground'>
										All project members can view this story
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
										Only selected members can view this story
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
						{hasAccessChanges && (
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

function VisibilityOption({
	active,
	icon,
	label,
	description,
	onClick,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'flex-1 flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-colors cursor-pointer',
				active
					? 'border-primary bg-primary/5'
					: 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
			)}
		>
			<div className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</div>
			<span className={cn('text-sm font-medium', active && 'text-primary')}>{label}</span>
			<span className='text-xs text-muted-foreground'>{description}</span>
		</button>
	);
}

function MemberPicker({
	members,
	selectedUserIds,
	isLoading,
	search,
	onSearchChange,
	onToggleUser,
}: {
	members: { id: string; name: string; email: string }[];
	selectedUserIds: Set<string>;
	isLoading: boolean;
	search: string;
	onSearchChange: (value: string) => void;
	onToggleUser: (userId: string) => void;
}) {
	return (
		<div className='flex flex-col gap-2'>
			<Input
				placeholder='Search members...'
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				className='h-8 text-sm'
			/>
			<div className='max-h-48 overflow-y-auto rounded-md border'>
				{isLoading ? (
					<div className='flex items-center justify-center py-6'>
						<Loader2 className='size-4 animate-spin text-muted-foreground' />
					</div>
				) : members.length === 0 ? (
					<div className='py-6 text-center text-sm text-muted-foreground'>
						{search ? 'No members found' : 'No other members in this project'}
					</div>
				) : (
					members.map((member) => (
						<MemberRow
							key={member.id}
							name={member.name}
							email={member.email}
							selected={selectedUserIds.has(member.id)}
							onClick={() => onToggleUser(member.id)}
						/>
					))
				)}
			</div>
			{selectedUserIds.size > 0 && (
				<p className='text-xs text-muted-foreground'>
					{selectedUserIds.size} {selectedUserIds.size === 1 ? 'person' : 'people'} selected
				</p>
			)}
		</div>
	);
}

function MemberRow({
	name,
	email,
	selected,
	onClick,
}: {
	name: string;
	email: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer',
				'hover:bg-muted/50',
				selected && 'bg-primary/5',
			)}
		>
			<Avatar username={name} size='sm' />
			<div className='min-w-0 flex-1'>
				<div className='text-sm font-medium truncate'>{name}</div>
				<div className='text-xs text-muted-foreground truncate'>{email}</div>
			</div>
			<div
				className={cn(
					'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
					selected ? 'border-primary bg-primary text-white' : 'border-muted-foreground/30',
				)}
			>
				{selected && <Check className='size-3' />}
			</div>
		</button>
	);
}
