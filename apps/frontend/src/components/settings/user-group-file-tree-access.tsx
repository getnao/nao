import { isFileTreeFileGranted, normalizeFileTreeAccess } from '@nao/shared';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FileTreeAccess, FileTreeGrant } from '@nao/shared';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

export interface FileTreeCatalogEntry {
	kind: 'folder' | 'file';
	path: string;
}

/** Copy for one grantable tree, so docs and project files share the same component. */
export interface FileTreeLabels {
	root: string;
	unit: string;
	emptyRoot: string;
	unavailableTitle: string;
	unavailableDescription: string;
}

export const DOCS_TREE_LABELS: FileTreeLabels = {
	root: 'docs',
	unit: 'doc',
	emptyRoot: 'The docs folder is empty.',
	unavailableTitle: 'Unavailable docs selections',
	unavailableDescription: 'These saved selections are not in the current docs folder.',
};

export const PROJECT_FILES_TREE_LABELS: FileTreeLabels = {
	root: 'files',
	unit: 'file',
	emptyRoot: 'The project has no files.',
	unavailableTitle: 'Unavailable file selections',
	unavailableDescription: 'These saved selections are not in the current project files.',
};

interface FileTreeNode extends FileTreeCatalogEntry {
	name: string;
	children: FileTreeNode[];
}

const PARTIAL_CHECKBOX_CLASS =
	'data-[state=indeterminate]:bg-primary/15 data-[state=indeterminate]:text-primary/70 data-[state=indeterminate]:shadow-none';

export function FileTreeAccessRoot({
	labels,
	entries,
	access,
	search,
	searching,
	syncState,
	isLoading,
	isError,
	disabled,
	onRetry,
	onChange,
}: {
	labels: FileTreeLabels;
	entries: FileTreeCatalogEntry[];
	access: FileTreeAccess;
	search: string;
	searching: boolean;
	syncState: 'missing' | 'ready' | undefined;
	isLoading: boolean;
	isError: boolean;
	disabled: boolean;
	onRetry: () => void;
	onChange: (access: FileTreeAccess) => void;
}) {
	const query = search.trim().toLocaleLowerCase();
	const rootMatches = query.length > 0 && labels.root.includes(query);
	const filteredEntries = useMemo(
		() => (!query || rootMatches ? entries : filterFileTreeEntries(entries, search)),
		[entries, query, rootMatches, search],
	);
	const nodes = useMemo(() => buildFileTree(filteredEntries), [filteredEntries]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [rootExpanded, setRootExpanded] = useState(false);
	const open = searching || rootExpanded;
	const visible =
		!query || rootMatches || filteredEntries.length > 0 || syncState === 'missing' || isLoading || isError;
	const selected = access.mode === 'all';
	const partial = !selected && hasSelectedDescendant(access, entries);

	if (!visible) {
		return null;
	}

	return (
		<li>
			<div
				className={cn(
					'flex h-8 w-full items-center gap-1 pr-2 text-sm hover:bg-muted/50',
					selected && 'bg-primary/10 text-primary',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(0)}px` }}
			>
				<button
					type='button'
					className='flex size-4 shrink-0 cursor-pointer items-center justify-center'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${labels.root} folder`}
					aria-expanded={open}
					onClick={() => setRootExpanded((current) => !current)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={partial ? 'indeterminate' : selected}
					disabled={disabled}
					aria-label={`${labels.root} folder access`}
					className={PARTIAL_CHECKBOX_CLASS}
					onCheckedChange={(checked) =>
						onChange(checked === true ? { mode: 'all' } : { mode: 'restricted', grants: [] })
					}
				/>
				<button
					type='button'
					className='flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left'
					onClick={() => setRootExpanded((current) => !current)}
				>
					<FileExplorerIcon name={labels.root} type='directory' className={cn(selected && 'text-primary')} />
					<span className='min-w-0 flex-1 truncate'>{labels.root}</span>
					{partial && <span className='shrink-0 text-[10px] text-muted-foreground'>Partial</span>}
				</button>
				<FileTreeRootStatus
					entryCount={entries.length}
					syncState={syncState}
					isLoading={isLoading}
					isError={isError}
					onRetry={onRetry}
				/>
			</div>
			{open && !isLoading && !isError && syncState === 'ready' && (
				<ul>
					{nodes.map((node) => (
						<FileTreeFolderNode
							key={`${node.kind}:${node.path}`}
							node={node}
							depth={1}
							access={access}
							expanded={expanded}
							searching={searching}
							selectionEntries={entries}
							onToggle={(path) =>
								setExpanded((current) => {
									const next = new Set(current);
									if (next.has(path)) {
										removeExpandedSubtree(next, path, '/');
									} else {
										next.add(path);
									}
									return next;
								})
							}
							onChange={onChange}
						/>
					))}
					{nodes.length === 0 && (
						<li
							className='flex h-8 items-center text-xs text-muted-foreground'
							style={{ paddingLeft: `${getTreeNodePadding(1)}px` }}
						>
							{query ? `No matching ${labels.unit}s.` : labels.emptyRoot}
						</li>
					)}
				</ul>
			)}
		</li>
	);
}

function FileTreeRootStatus({
	entryCount,
	syncState,
	isLoading,
	isError,
	onRetry,
}: {
	entryCount: number;
	syncState: 'missing' | 'ready' | undefined;
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
}) {
	if (isLoading) {
		return <span className='text-xs text-muted-foreground'>Loading...</span>;
	}
	if (isError) {
		return (
			<Button
				type='button'
				size='sm'
				variant='ghost'
				className='h-6 px-2 text-xs text-destructive'
				onClick={(event) => {
					event.stopPropagation();
					onRetry();
				}}
			>
				Retry
			</Button>
		);
	}
	if (syncState === 'missing') {
		return <span className='text-xs text-muted-foreground'>Missing</span>;
	}
	if (entryCount === 0) {
		return <span className='text-xs text-muted-foreground'>Empty</span>;
	}
	return null;
}

function FileTreeFolderNode({
	node,
	depth,
	access,
	expanded,
	searching,
	selectionEntries,
	onToggle,
	onChange,
}: {
	node: FileTreeNode;
	depth: number;
	access: FileTreeAccess;
	expanded: Set<string>;
	searching: boolean;
	selectionEntries: FileTreeCatalogEntry[];
	onToggle: (path: string) => void;
	onChange: (access: FileTreeAccess) => void;
}) {
	if (node.kind === 'file') {
		return <FileTreeFileRow node={node} depth={depth} access={access} onChange={onChange} />;
	}

	const displayed = getCompactFolder(node, access);
	const explicit = hasGrant(access, { kind: 'folder', path: displayed.path });
	const inherited = access.mode === 'all' || hasAncestorFolderGrant(access, displayed.path);
	const selected = explicit || inherited;
	const partial = !selected && hasSelectedDescendant(access, selectionEntries, displayed.path);
	const open = searching || expanded.has(displayed.path);

	return (
		<li>
			<div
				className={cn(
					'flex h-8 w-full items-center gap-1 pr-2 text-sm hover:bg-muted/50',
					selected && 'bg-primary/10 text-primary',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				<button
					type='button'
					className='flex size-4 shrink-0 cursor-pointer items-center justify-center'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${displayed.label} folder`}
					aria-expanded={open}
					onClick={() => onToggle(displayed.path)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={partial ? 'indeterminate' : selected}
					disabled={inherited && !explicit}
					title={
						inherited && !explicit
							? 'Allowed by a parent folder. Remove that folder grant to revoke access.'
							: undefined
					}
					aria-label={`${displayed.label} folder access`}
					className={PARTIAL_CHECKBOX_CLASS}
					onCheckedChange={(checked) =>
						onChange(
							toggleFileTreeGrant(access, { kind: 'folder', path: displayed.path }, checked === true),
						)
					}
				/>
				<button
					type='button'
					className='flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left'
					onClick={() => onToggle(displayed.path)}
				>
					<FileExplorerIcon
						name={displayed.name}
						type='directory'
						className={cn(selected && 'text-primary')}
					/>
					<span className='min-w-0 flex-1 truncate' title={displayed.label}>
						{displayed.label}
					</span>
					{inherited && !explicit && <span className='text-[10px] text-primary/80'>Inherited</span>}
					{partial && <span className='shrink-0 text-[10px] text-muted-foreground'>Partial</span>}
				</button>
			</div>
			{open && (
				<ul>
					{displayed.children.map((child) => (
						<FileTreeFolderNode
							key={`${child.kind}:${child.path}`}
							node={child}
							depth={depth + 1}
							access={access}
							expanded={expanded}
							searching={searching}
							selectionEntries={selectionEntries}
							onToggle={onToggle}
							onChange={onChange}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FileTreeFileRow({
	node,
	depth,
	access,
	onChange,
}: {
	node: FileTreeNode;
	depth: number;
	access: FileTreeAccess;
	onChange: (access: FileTreeAccess) => void;
}) {
	const grant: FileTreeGrant = { kind: 'file', path: node.path };
	const explicit = hasGrant(access, grant);
	const inherited = access.mode === 'all' || hasAncestorFolderGrant(access, node.path);
	const selected = explicit || inherited;
	return (
		<li
			className={cn(
				'flex h-8 items-center gap-1 pr-2 text-sm hover:bg-muted/50',
				selected && 'bg-primary/10 text-primary',
			)}
			style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
		>
			<span className='size-4 shrink-0' />
			<Checkbox
				checked={selected}
				disabled={inherited && !explicit}
				title={
					inherited && !explicit
						? 'Allowed by a parent folder. Remove that folder grant to revoke access.'
						: undefined
				}
				aria-label={`${node.name} file access`}
				onCheckedChange={(checked) => onChange(toggleFileTreeGrant(access, grant, checked === true))}
			/>
			<FileExplorerIcon name={node.name} type='file' />
			<span className='min-w-0 flex-1 truncate' title={node.path}>
				{node.name}
			</span>
			{inherited && !explicit && <span className='text-[10px] text-primary/80'>Inherited</span>}
		</li>
	);
}

export function UnavailableFileTreeGrants({
	labels,
	grants,
	access,
	onChange,
}: {
	labels: FileTreeLabels;
	grants: FileTreeGrant[];
	access: FileTreeAccess;
	onChange: (access: FileTreeAccess) => void;
}) {
	return (
		<div className='flex flex-col gap-2 border-t pt-4'>
			<div>
				<h3 className='text-sm font-medium'>{labels.unavailableTitle}</h3>
				<p className='text-xs text-muted-foreground'>{labels.unavailableDescription}</p>
			</div>
			<ul className='rounded-lg border'>
				{grants.map((grant) => (
					<li
						key={`${grant.kind}:${grant.path}`}
						className='flex min-h-11 items-center gap-3 border-b px-3 last:border-b-0'
					>
						<Checkbox
							checked
							aria-label={`Remove unavailable ${grant.kind} ${grant.path}`}
							onCheckedChange={(checked) => {
								if (checked !== true) {
									onChange(toggleFileTreeGrant(access, grant, false));
								}
							}}
						/>
						<FileExplorerIcon
							name={grant.path.split('/').at(-1) ?? grant.path}
							type={grant.kind === 'folder' ? 'directory' : 'file'}
						/>
						<span className='min-w-0 break-all text-sm'>{grant.path}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function toggleFileTreeGrant(access: FileTreeAccess, grant: FileTreeGrant, checked: boolean): FileTreeAccess {
	if (access.mode === 'all') {
		return access;
	}
	const remaining = access.grants.filter((item) => item.kind !== grant.kind || item.path !== grant.path);
	return normalizeFileTreeAccess({
		mode: 'restricted',
		grants: checked ? [...remaining, grant] : remaining,
	});
}

export function getUnavailableFileTreeGrants(
	access: FileTreeAccess,
	entries: readonly FileTreeCatalogEntry[],
): FileTreeGrant[] {
	if (access.mode === 'all') {
		return [];
	}
	return access.grants.filter(
		(grant) => !entries.some((entry) => entry.kind === grant.kind && entry.path === grant.path),
	);
}

export function getFileTreeSelectionSummary(
	labels: FileTreeLabels,
	access: FileTreeAccess,
	entries: readonly FileTreeCatalogEntry[],
): string {
	const count = getFileTreeSelectionCount(access, entries);
	const unavailable = getUnavailableFileTreeGrants(access, entries).length;
	return `${count} ${count === 1 ? labels.unit : `${labels.unit}s`}${unavailable ? ` · ${unavailable} unavailable` : ''}`;
}

export function getFileTreeSelectionCount(access: FileTreeAccess, entries: readonly FileTreeCatalogEntry[]): number {
	return entries.filter((entry) => entry.kind === 'file' && isFileTreeFileGranted(access, entry.path)).length;
}

export function filterFileTreeEntries(
	entries: readonly FileTreeCatalogEntry[],
	search: string,
): FileTreeCatalogEntry[] {
	const query = search.trim().toLocaleLowerCase();
	if (!query) {
		return [...entries];
	}
	const matchingPaths = entries
		.filter((entry) => entry.path.toLocaleLowerCase().includes(query))
		.map((entry) => entry.path);
	return entries.filter((entry) =>
		matchingPaths.some((matchingPath) => matchingPath === entry.path || matchingPath.startsWith(`${entry.path}/`)),
	);
}

function buildFileTree(entries: readonly FileTreeCatalogEntry[]): FileTreeNode[] {
	const nodes = new Map<string, FileTreeNode>();
	for (const entry of entries) {
		const segments = entry.path.split('/');
		for (let index = 0; index < segments.length; index++) {
			const nodePath = segments.slice(0, index + 1).join('/');
			const kind = index === segments.length - 1 ? entry.kind : 'folder';
			const existing = nodes.get(nodePath);
			if (!existing) {
				nodes.set(nodePath, { kind, path: nodePath, name: segments[index], children: [] });
			}
		}
	}
	for (const node of nodes.values()) {
		const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
		if (parentPath) {
			nodes.get(parentPath)?.children.push(node);
		}
	}
	for (const node of nodes.values()) {
		node.children.sort(compareFileTreeNodes);
	}
	return [...nodes.values()].filter((node) => !node.path.includes('/')).sort(compareFileTreeNodes);
}

function getCompactFolder(node: FileTreeNode, access: FileTreeAccess) {
	let current = node;
	const names = [node.name];
	while (
		current.kind === 'folder' &&
		!hasGrant(access, { kind: 'folder', path: current.path }) &&
		current.children.length === 1 &&
		current.children[0].kind === 'folder' &&
		!hasGrant(access, { kind: 'folder', path: current.children[0].path })
	) {
		current = current.children[0];
		names.push(current.name);
	}
	return { ...current, label: names.join('/') };
}

function compareFileTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
	return Number(right.kind === 'folder') - Number(left.kind === 'folder') || left.name.localeCompare(right.name);
}

function hasGrant(access: FileTreeAccess, grant: FileTreeGrant): boolean {
	return (
		access.mode === 'restricted' &&
		access.grants.some((item) => item.kind === grant.kind && item.path === grant.path)
	);
}

function hasAncestorFolderGrant(access: FileTreeAccess, filePath: string): boolean {
	return (
		access.mode === 'restricted' &&
		access.grants.some(
			(grant) => grant.kind === 'folder' && filePath !== grant.path && filePath.startsWith(`${grant.path}/`),
		)
	);
}

function hasSelectedDescendant(
	access: FileTreeAccess,
	entries: readonly FileTreeCatalogEntry[],
	parentPath?: string,
): boolean {
	return entries.some((entry) => {
		if (parentPath && (entry.path === parentPath || !entry.path.startsWith(`${parentPath}/`))) {
			return false;
		}
		return entry.kind === 'file'
			? isFileTreeFileGranted(access, entry.path)
			: hasGrant(access, { kind: 'folder', path: entry.path }) || hasAncestorFolderGrant(access, entry.path);
	});
}
