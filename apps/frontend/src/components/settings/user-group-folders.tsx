import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, FolderPlus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { FolderItem } from '@/lib/stories-page';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { FolderCreateDialog } from '@/components/stories-folder-create-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getFolderPath, isSystemFolder, ownsTeamGroups } from '@/lib/stories-page';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface UserGroupFoldersProps {
	groupId: string | null;
	folderIds: string[];
	savedFolderIds: string[];
	isLicensed: boolean;
	onFolderIdsChange: (folderIds: string[]) => void;
	onFolderCreated: (folderId: string) => void;
}

interface PublicFolderRow {
	folder: FolderItem;
	depth: number;
}

export function UserGroupFolders({
	groupId,
	folderIds,
	savedFolderIds,
	isLicensed,
	onFolderIdsChange,
	onFolderCreated,
}: UserGroupFoldersProps) {
	const tree = useQuery(trpc.storyFolder.listTree.queryOptions());
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const newFolderGroupIds = useMemo(() => (groupId ? [groupId] : []), [groupId]);
	const folders = tree.data ?? [];
	const publicFolderRows = listPublicFolderRows(folders);
	const teamFolderIds = new Set([...folderIds, ...listOtherGroupsTeamFolderIds(folders, groupId)]);
	const openedFolderNames = listFoldersOpenedToEveryone(folders, groupId, savedFolderIds, folderIds);

	const addFolderCreatedForGroup = (folderId: string, createdGroupIds: string[]) => {
		if (groupId && createdGroupIds.includes(groupId)) {
			onFolderCreated(folderId);
		}
	};

	const toggleFolder = (folderId: string, checked: boolean) => {
		onFolderIdsChange(checked ? [...folderIds, folderId] : folderIds.filter((id) => id !== folderId));
	};

	return (
		<section className='flex min-h-64 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Team folders</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Only members of this group and admins see these story folders and can add stories to them.
						Stories filed there are shared with the group.
					</p>
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
				{isLicensed && groupId && (
					<Button
						variant='outline'
						size='sm'
						className='shrink-0 gap-1.5 rounded-full'
						onClick={() => setIsCreateOpen(true)}
					>
						<FolderPlus className='size-3.5' />
						New folder
					</Button>
				)}
			</div>
			{openedFolderNames.length > 0 && (
				<p className='flex items-center gap-1.5 text-xs text-amber-600'>
					<TriangleAlert className='size-3.5 shrink-0' />
					{`Saving will make ${openedFolderNames.join(', ')} visible to everyone in the project.`}
				</p>
			)}
			<div className='max-h-96 overflow-auto rounded-lg border'>
				{tree.isLoading ? (
					<p className='p-3 text-sm text-muted-foreground'>Loading folders...</p>
				) : publicFolderRows.length === 0 ? (
					<p className='p-3 text-sm text-muted-foreground'>No public story folders yet.</p>
				) : (
					<ul className='divide-y'>
						{publicFolderRows.map(({ folder, depth }) => (
							<UserGroupFolderRow
								key={folder.id}
								label={depth === 0 ? getFolderPath(folders, folder) : folder.name}
								path={getFolderPath(folders, folder)}
								depth={depth}
								isSelected={folderIds.includes(folder.id)}
								blockedReason={
									isLicensed || savedFolderIds.includes(folder.id)
										? describeNestingBlock(folder, folders, teamFolderIds)
										: 'Requires an Enterprise license'
								}
								onCheckedChange={(checked) => toggleFolder(folder.id, checked)}
							/>
						))}
					</ul>
				)}
			</div>
			{isLicensed && groupId && (
				<FolderCreateDialog
					open={isCreateOpen}
					onOpenChange={setIsCreateOpen}
					mode='create'
					initialGroupIds={newFolderGroupIds}
					onCreated={addFolderCreatedForGroup}
				/>
			)}
		</section>
	);
}

/** Folders this group opens directly; their subfolders follow them. */
export function listGroupTeamFolderIds(folders: FolderItem[], groupId: string): string[] {
	return folders
		.filter((folder) => ownsTeamGroups(folder, folders) && folder.teamGroupIds.includes(groupId))
		.map((folder) => folder.id);
}

function UserGroupFolderRow({
	label,
	path,
	depth,
	isSelected,
	blockedReason,
	onCheckedChange,
}: {
	label: string;
	path: string;
	depth: number;
	isSelected: boolean;
	blockedReason: string | null;
	onCheckedChange: (checked: boolean) => void;
}) {
	const isDisabled = !isSelected && blockedReason !== null;
	return (
		<li className={cn('flex items-center gap-3 p-3', isSelected && 'bg-primary/5')}>
			<Checkbox
				checked={isSelected}
				aria-label={`${path} folder access`}
				disabled={isDisabled}
				className='disabled:cursor-default'
				onCheckedChange={(checked) => onCheckedChange(checked === true)}
			/>
			<span
				className={cn('flex min-w-0 flex-1 items-center gap-2', isDisabled && 'text-muted-foreground')}
				style={{ paddingLeft: `${depth * 16}px` }}
				title={path}
			>
				{depth > 0 && <ChevronRight className='size-3 shrink-0 text-muted-foreground/50' />}
				<Folder className='size-3.5 shrink-0 text-muted-foreground' />
				<span className='truncate text-sm font-medium'>{label}</span>
			</span>
			{isDisabled && <span className='shrink-0 text-xs text-muted-foreground'>{blockedReason}</span>}
		</li>
	);
}

/** Depth-first so each subfolder sits right under its parent; a folder whose parent is hidden starts a new root. */
function listPublicFolderRows(folders: FolderItem[]): PublicFolderRow[] {
	const publicFolders = folders.filter((folder) => folder.visibility === 'public' && !isSystemFolder(folder));
	const publicIds = new Set(publicFolders.map((folder) => folder.id));
	const roots = publicFolders.filter((folder) => !folder.parentId || !publicIds.has(folder.parentId));
	return listFolderRows(roots, publicFolders, folders, 0);
}

function listFolderRows(
	siblings: FolderItem[],
	publicFolders: FolderItem[],
	folders: FolderItem[],
	depth: number,
): PublicFolderRow[] {
	return [...siblings]
		.sort((a, b) => getFolderPath(folders, a).localeCompare(getFolderPath(folders, b)))
		.flatMap((folder) => [
			{ folder, depth },
			...listFolderRows(
				publicFolders.filter((child) => child.parentId === folder.id),
				publicFolders,
				folders,
				depth + 1,
			),
		]);
}

function listOtherGroupsTeamFolderIds(folders: FolderItem[], groupId: string | null): string[] {
	return folders
		.filter(
			(folder) =>
				ownsTeamGroups(folder, folders) && folder.teamGroupIds.some((teamGroupId) => teamGroupId !== groupId),
		)
		.map((folder) => folder.id);
}

function listFoldersOpenedToEveryone(
	folders: FolderItem[],
	groupId: string | null,
	savedFolderIds: string[],
	folderIds: string[],
): string[] {
	return folders
		.filter(
			(folder) =>
				savedFolderIds.includes(folder.id) &&
				!folderIds.includes(folder.id) &&
				folder.teamGroupIds.every((teamGroupId) => teamGroupId === groupId),
		)
		.map((folder) => `"${folder.name}"`);
}

/** Team folders do not nest: a folder inside or around another team folder follows that one instead. */
function describeNestingBlock(folder: FolderItem, folders: FolderItem[], teamFolderIds: Set<string>): string | null {
	if (listAncestorIds(folder, folders).some((id) => teamFolderIds.has(id))) {
		return 'Inside a team folder';
	}
	const containsTeamFolder = folders.some(
		(candidate) => teamFolderIds.has(candidate.id) && listAncestorIds(candidate, folders).includes(folder.id),
	);
	return containsTeamFolder ? 'Contains a team folder' : null;
}

function listAncestorIds(folder: FolderItem, folders: FolderItem[]): string[] {
	const parent = folders.find((candidate) => candidate.id === folder.parentId);
	return parent ? [parent.id, ...listAncestorIds(parent, folders)] : [];
}
