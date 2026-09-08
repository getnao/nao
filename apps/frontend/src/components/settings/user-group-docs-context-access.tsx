import { isDocsContextFileGranted, normalizeDocsContextAccess } from '@nao/shared';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DocsContextAccess, DocsContextGrant } from '@nao/shared';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

export interface DocsContextCatalogEntry {
	kind: 'folder' | 'file';
	path: string;
}

interface DocsTreeNode extends DocsContextCatalogEntry {
	name: string;
	children: DocsTreeNode[];
}

export function DocsContextTreeRoot({
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
	entries: DocsContextCatalogEntry[];
	access: DocsContextAccess;
	search: string;
	searching: boolean;
	syncState: 'missing' | 'ready' | undefined;
	isLoading: boolean;
	isError: boolean;
	disabled: boolean;
	onRetry: () => void;
	onChange: (access: DocsContextAccess) => void;
}) {
	const query = search.trim().toLocaleLowerCase();
	const rootMatches = query.length > 0 && 'docs'.includes(query);
	const filteredEntries = useMemo(
		() => (!query || rootMatches ? entries : filterDocsContextEntries(entries, search)),
		[entries, query, rootMatches, search],
	);
	const nodes = useMemo(() => buildDocsTree(filteredEntries), [filteredEntries]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [rootExpanded, setRootExpanded] = useState(false);
	const open = searching || rootExpanded;
	const visible =
		!query || rootMatches || filteredEntries.length > 0 || syncState === 'missing' || isLoading || isError;

	if (!visible) {
		return null;
	}

	return (
		<li>
			<div
				className={cn(
					'flex h-8 w-full items-center gap-1 pr-2 text-sm hover:bg-muted/50',
					access.mode === 'all' && 'bg-primary/10 text-primary',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(0)}px` }}
			>
				<button
					type='button'
					className='flex size-4 shrink-0 items-center justify-center'
					aria-label={`${open ? 'Collapse' : 'Expand'} docs folder`}
					aria-expanded={open}
					onClick={() => setRootExpanded((current) => !current)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={access.mode === 'all'}
					disabled={disabled}
					aria-label='docs folder access'
					onCheckedChange={(checked) =>
						onChange(checked === true ? { mode: 'all' } : { mode: 'restricted', grants: [] })
					}
				/>
				<button
					type='button'
					className='flex min-w-0 flex-1 items-center gap-1 text-left'
					onClick={() => setRootExpanded((current) => !current)}
				>
					<FileExplorerIcon name='docs' type='directory' />
					<span className='min-w-0 flex-1 truncate'>docs</span>
				</button>
				<DocsRootStatus
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
						<DocsNode
							key={`${node.kind}:${node.path}`}
							node={node}
							depth={1}
							access={access}
							expanded={expanded}
							searching={searching}
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
							{query ? 'No matching docs.' : 'The docs folder is empty.'}
						</li>
					)}
				</ul>
			)}
		</li>
	);
}

function DocsRootStatus({
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

function DocsNode({
	node,
	depth,
	access,
	expanded,
	searching,
	onToggle,
	onChange,
}: {
	node: DocsTreeNode;
	depth: number;
	access: DocsContextAccess;
	expanded: Set<string>;
	searching: boolean;
	onToggle: (path: string) => void;
	onChange: (access: DocsContextAccess) => void;
}) {
	if (node.kind === 'file') {
		return <DocsFileRow node={node} depth={depth} access={access} onChange={onChange} />;
	}

	const displayed = getCompactFolder(node, access);
	const explicit = hasDocsGrant(access, { kind: 'folder', path: displayed.path });
	const inherited = access.mode === 'all' || hasAncestorFolderGrant(access, displayed.path);
	const selected = explicit || inherited;
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
					className='flex size-4 shrink-0 items-center justify-center'
					aria-label={`${open ? 'Collapse' : 'Expand'} ${displayed.label} folder`}
					aria-expanded={open}
					onClick={() => onToggle(displayed.path)}
				>
					<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				</button>
				<Checkbox
					checked={selected}
					disabled={inherited && !explicit}
					title={
						inherited && !explicit
							? 'Allowed by a parent folder. Remove that folder grant to revoke access.'
							: undefined
					}
					aria-label={`${displayed.label} folder access`}
					onCheckedChange={(checked) =>
						onChange(
							toggleDocsContextGrant(access, { kind: 'folder', path: displayed.path }, checked === true),
						)
					}
				/>
				<button
					type='button'
					className='flex min-w-0 flex-1 items-center gap-1 text-left'
					onClick={() => onToggle(displayed.path)}
				>
					<FileExplorerIcon name={displayed.name} type='directory' />
					<span className='min-w-0 flex-1 truncate' title={displayed.label}>
						{displayed.label}
					</span>
					{inherited && !explicit && <span className='text-[10px] text-primary/80'>Inherited</span>}
				</button>
			</div>
			{open && (
				<ul>
					{displayed.children.map((child) => (
						<DocsNode
							key={`${child.kind}:${child.path}`}
							node={child}
							depth={depth + 1}
							access={access}
							expanded={expanded}
							searching={searching}
							onToggle={onToggle}
							onChange={onChange}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function DocsFileRow({
	node,
	depth,
	access,
	onChange,
}: {
	node: DocsTreeNode;
	depth: number;
	access: DocsContextAccess;
	onChange: (access: DocsContextAccess) => void;
}) {
	const grant: DocsContextGrant = { kind: 'file', path: node.path };
	const explicit = hasDocsGrant(access, grant);
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
				onCheckedChange={(checked) => onChange(toggleDocsContextGrant(access, grant, checked === true))}
			/>
			<FileExplorerIcon name={node.name} type='file' />
			<span className='min-w-0 flex-1 truncate' title={node.path}>
				{node.name}
			</span>
			{inherited && !explicit && <span className='text-[10px] text-primary/80'>Inherited</span>}
		</li>
	);
}

export function UnavailableDocsGrants({
	grants,
	access,
	onChange,
}: {
	grants: DocsContextGrant[];
	access: DocsContextAccess;
	onChange: (access: DocsContextAccess) => void;
}) {
	return (
		<div className='flex flex-col gap-2 border-t pt-4'>
			<div>
				<h3 className='text-sm font-medium'>Unavailable docs selections</h3>
				<p className='text-xs text-muted-foreground'>
					These saved selections are not in the current docs folder.
				</p>
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
									onChange(toggleDocsContextGrant(access, grant, false));
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

export function toggleDocsContextGrant(
	access: DocsContextAccess,
	grant: DocsContextGrant,
	checked: boolean,
): DocsContextAccess {
	if (access.mode === 'all') {
		return access;
	}
	const remaining = access.grants.filter((item) => item.kind !== grant.kind || item.path !== grant.path);
	return normalizeDocsContextAccess({
		mode: 'restricted',
		grants: checked ? [...remaining, grant] : remaining,
	});
}

export function getUnavailableDocsContextGrants(
	access: DocsContextAccess,
	entries: readonly DocsContextCatalogEntry[],
): DocsContextGrant[] {
	if (access.mode === 'all') {
		return [];
	}
	return access.grants.filter(
		(grant) => !entries.some((entry) => entry.kind === grant.kind && entry.path === grant.path),
	);
}

export function getDocsContextSelectionSummary(
	access: DocsContextAccess,
	entries: readonly DocsContextCatalogEntry[],
): string {
	const count = getDocsContextSelectionCount(access, entries);
	const unavailable = getUnavailableDocsContextGrants(access, entries).length;
	return `${count} ${count === 1 ? 'doc' : 'docs'}${unavailable ? ` · ${unavailable} unavailable` : ''}`;
}

export function getDocsContextSelectionCount(
	access: DocsContextAccess,
	entries: readonly DocsContextCatalogEntry[],
): number {
	return entries.filter((entry) => entry.kind === 'file' && isDocsContextFileGranted(access, entry.path)).length;
}

export function filterDocsContextEntries(
	entries: readonly DocsContextCatalogEntry[],
	search: string,
): DocsContextCatalogEntry[] {
	const query = search.trim().toLocaleLowerCase();
	if (!query) {
		return [...entries];
	}
	const matchingPaths = entries
		.filter((entry) => entry.path.toLocaleLowerCase().includes(query))
		.map((entry) => entry.path);
	return entries.filter(
		(entry) =>
			matchingPaths.some(
				(matchingPath) => matchingPath === entry.path || matchingPath.startsWith(`${entry.path}/`),
			) ||
			(entry.kind === 'file' && matchingPaths.includes(entry.path)),
	);
}

function buildDocsTree(entries: readonly DocsContextCatalogEntry[]): DocsTreeNode[] {
	const nodes = new Map<string, DocsTreeNode>();
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
		node.children.sort(compareDocsNodes);
	}
	return [...nodes.values()].filter((node) => !node.path.includes('/')).sort(compareDocsNodes);
}

function getCompactFolder(node: DocsTreeNode, access: DocsContextAccess) {
	let current = node;
	const names = [node.name];
	while (
		current.kind === 'folder' &&
		!hasDocsGrant(access, { kind: 'folder', path: current.path }) &&
		current.children.length === 1 &&
		current.children[0].kind === 'folder' &&
		!hasDocsGrant(access, { kind: 'folder', path: current.children[0].path })
	) {
		current = current.children[0];
		names.push(current.name);
	}
	return { ...current, label: names.join('/') };
}

function compareDocsNodes(left: DocsTreeNode, right: DocsTreeNode): number {
	return Number(right.kind === 'folder') - Number(left.kind === 'folder') || left.name.localeCompare(right.name);
}

function hasDocsGrant(access: DocsContextAccess, grant: DocsContextGrant): boolean {
	return (
		access.mode === 'restricted' &&
		access.grants.some((item) => item.kind === grant.kind && item.path === grant.path)
	);
}

function hasAncestorFolderGrant(access: DocsContextAccess, docsPath: string): boolean {
	return (
		access.mode === 'restricted' &&
		access.grants.some(
			(grant) => grant.kind === 'folder' && docsPath !== grant.path && docsPath.startsWith(`${grant.path}/`),
		)
	);
}
