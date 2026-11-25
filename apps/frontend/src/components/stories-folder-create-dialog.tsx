import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Folder, FolderLock, FolderUsers, Globe, Lock, Users } from 'lucide-react';

import type { FolderItem } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GroupRow } from '@/components/share-dialog';
import { FolderTreeSelect, getTargetAudience } from '@/components/stories-folder-tree-select';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

type Mode = 'create' | 'modify';

const NO_GROUPS: string[] = [];

export function FolderCreateDialog({
	open,
	onOpenChange,
	mode,
	initialName,
	folderId,
	parentId,
	initialGroupIds = NO_GROUPS,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: Mode;
	initialName?: string;
	folderId?: string;
	parentId?: string | null;
	initialGroupIds?: string[];
	onCreated?: (folderId: string, groupIds: string[]) => void;
}) {
	const [name, setName] = useState(initialName ?? '');
	const [selectedParentId, setSelectedParentId] = useState<string | null>(parentId ?? null);
	const [groupIds, setGroupIds] = useState<string[]>(initialGroupIds);
	const inputRef = useRef<HTMLInputElement>(null);
	const queryClient = useQueryClient();

	const treeQuery = useQuery(trpc.storyFolder.listTree.queryOptions());
	const tree = treeQuery.data ?? [];
	const licenseFeatures = useLicenseFeatures();
	const hasTeamFolders = licenseFeatures.data?.['row-level-security'] === true;
	const groupsQuery = useQuery({
		...trpc.storyShare.listShareableGroups.queryOptions(),
		enabled: open && mode === 'create' && hasTeamFolders,
	});
	const groups = groupsQuery.data ?? [];
	const isAudienceLoading =
		mode === 'create' && (treeQuery.isLoading || licenseFeatures.isLoading || groupsQuery.isLoading);
	const groupsFailedToLoad =
		mode === 'create' && groupIds.length > 0 && (groupsQuery.isError || licenseFeatures.isError);

	const parentAudience = getTargetAudience(selectedParentId, tree);
	const willBePrivate = parentAudience === 'private';
	const canPickGroups = mode === 'create' && hasTeamFolders && parentAudience === 'public' && groups.length > 0;
	const selectedGroupIds = canPickGroups ? groupIds : NO_GROUPS;
	const willBeTeam = parentAudience === 'team' || selectedGroupIds.length > 0;

	const createMutation = useMutation(
		trpc.storyFolder.create.mutationOptions({
			onSuccess: (folder, variables) => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				onCreated?.(folder.id, variables.groupIds ?? []);
				onOpenChange(false);
			},
		}),
	);

	const renameMutation = useMutation(
		trpc.storyFolder.rename.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const { reset: resetCreate } = createMutation;
	const { reset: resetRename } = renameMutation;

	useEffect(() => {
		if (open) {
			setName(initialName ?? '');
			setSelectedParentId(parentId ?? null);
			setGroupIds(initialGroupIds);
			resetCreate();
			resetRename();
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [open, initialName, parentId, initialGroupIds, resetCreate, resetRename]);

	const isPending = createMutation.isPending || renameMutation.isPending;
	const mutationError = createMutation.error ?? renameMutation.error;
	const trimmed = name.trim();

	function handleSubmit() {
		if (!trimmed || isAudienceLoading || groupsFailedToLoad) {
			return;
		}
		if (mode === 'create') {
			createMutation.mutate({ name: trimmed, parentId: selectedParentId, groupIds: selectedGroupIds });
		} else if (folderId) {
			renameMutation.mutate({ id: folderId, name: trimmed });
		}
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
			handleSubmit();
		}
	}

	const FolderIconComponent = willBePrivate ? FolderLock : willBeTeam ? FolderUsers : Folder;

	function isDisabledForCreate(folder: FolderItem): boolean {
		return folder.systemType === 'shared_with_me';
	}

	function toggleGroup(groupId: string) {
		setGroupIds((current) =>
			current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId],
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-sm'>
				<DialogHeader>
					<DialogTitle>{mode === 'create' ? 'New folder' : 'Rename folder'}</DialogTitle>
				</DialogHeader>

				{mode === 'create' && (
					<FolderTreeSelect
						tree={tree}
						selectedId={selectedParentId}
						onSelect={setSelectedParentId}
						isDisabled={isDisabledForCreate}
					/>
				)}

				<div className='flex items-center gap-2.5 rounded-md border bg-background px-3 py-2'>
					<FolderIconComponent className='size-4 shrink-0 text-muted-foreground' />
					<input
						ref={inputRef}
						type='text'
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder='Folder name'
						maxLength={100}
						className='flex-1 bg-transparent text-sm outline-none'
					/>
				</div>
				{canPickGroups && (
					<div className='flex flex-col gap-1'>
						<span className='text-xs font-medium text-muted-foreground'>Limit to groups (optional)</span>
						<div className='max-h-40 overflow-y-auto'>
							{groups.map((group) => (
								<GroupRow
									key={group.id}
									name={group.name}
									memberCount={group.memberCount}
									selected={selectedGroupIds.includes(group.id)}
									onClick={() => toggleGroup(group.id)}
								/>
							))}
						</div>
					</div>
				)}
				{mode === 'create' && (
					<p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
						{willBePrivate ? (
							<>
								<Lock className='size-3 shrink-0' />
								<span>
									This folder will be <strong>private</strong>
								</span>
							</>
						) : willBeTeam ? (
							<>
								<Users className='size-3 shrink-0' />
								<span>
									Only admins and <strong>members of its groups</strong> will see this folder
								</span>
							</>
						) : (
							<>
								<Globe className='size-3 shrink-0' />
								<span>
									This folder will be <strong>public</strong>
								</span>
							</>
						)}
					</p>
				)}
				{groupsFailedToLoad && (
					<p className='text-xs text-destructive'>
						Could not load the groups for this folder. Try again later.
					</p>
				)}
				{mutationError && <p className='text-xs text-destructive'>{mutationError.message}</p>}
				<DialogFooter>
					<Button
						variant='ghost'
						className='rounded-full border'
						onClick={() => onOpenChange(false)}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						className='rounded-full'
						onClick={handleSubmit}
						disabled={!trimmed || isPending || isAudienceLoading || groupsFailedToLoad}
					>
						{mode === 'create' ? 'Create' : 'Save'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
