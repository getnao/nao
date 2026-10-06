import { isDatabaseContextTableGranted, isFileTreeFileGranted, matchesDatabaseContextPattern } from '@nao/shared';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DatabaseContextAccess, DocsContextAccess, FilesContextAccess } from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { FileTreeCatalogEntry } from '@/components/settings/user-group-file-tree-access';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

type CatalogState = 'loading' | 'error' | 'ready';
type SyncState = 'missing' | 'ready';

interface UserGroupEffectiveContextProps {
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	filesAccess: FilesContextAccess;
	contextObjects: DatabaseContextObject[];
	docsEntries: FileTreeCatalogEntry[];
	filesEntries: FileTreeCatalogEntry[];
	databaseCatalogState?: CatalogState;
	docsCatalogState?: CatalogState;
	filesCatalogState?: CatalogState;
	databaseSyncState?: SyncState;
	docsSyncState?: SyncState;
	filesSyncState?: SyncState;
	onRetryDatabaseCatalog?: () => void;
	onRetryDocsCatalog?: () => void;
	onRetryFilesCatalog?: () => void;
}

interface DatabaseGroup {
	key: string;
	databaseType: string;
	database: string;
	schemas: DatabaseSchemaGroup[];
}

interface DatabaseSchemaGroup {
	key: string;
	schema: string;
	tables: DatabaseContextObject[];
}

interface ContextTreeEntry {
	kind: 'folder' | 'file';
	path: string;
}

interface ContextTreeNode extends ContextTreeEntry {
	name: string;
	children: ContextTreeNode[];
}

export function UserGroupEffectiveContext({
	databaseAccess,
	docsAccess,
	filesAccess,
	contextObjects,
	docsEntries,
	filesEntries,
	databaseCatalogState = 'ready',
	docsCatalogState = 'ready',
	filesCatalogState = 'ready',
	databaseSyncState = 'ready',
	docsSyncState = 'ready',
	filesSyncState = 'ready',
	onRetryDatabaseCatalog,
	onRetryDocsCatalog,
	onRetryFilesCatalog,
}: UserGroupEffectiveContextProps) {
	const [search, setSearch] = useState('');
	const [expandedDatabaseKeys, setExpandedDatabaseKeys] = useState<Set<string>>(new Set());
	const [expandedDocsPaths, setExpandedDocsPaths] = useState<Set<string>>(new Set());
	const [expandedFilesPaths, setExpandedFilesPaths] = useState<Set<string>>(new Set());
	const [docsExpanded, setDocsExpanded] = useState(false);
	const [filesExpanded, setFilesExpanded] = useState(false);
	const query = search.trim().toLocaleLowerCase();
	const searching = query.length > 0;

	const allowedTables = useMemo(
		() =>
			deduplicateTables(contextObjects.filter((object) => isDatabaseContextTableGranted(databaseAccess, object))),
		[contextObjects, databaseAccess],
	);
	const visibleTables = useMemo(
		() =>
			query
				? allowedTables.filter((object) =>
						[object.databaseType, object.database, object.schema, object.table].some((value) =>
							value.toLocaleLowerCase().includes(query),
						),
					)
				: allowedTables,
		[allowedTables, query],
	);
	const allowedDocsFiles = useMemo(
		() =>
			deduplicateEntries(
				docsEntries.filter((entry) => entry.kind === 'file' && isFileTreeFileGranted(docsAccess, entry.path)),
			),
		[docsAccess, docsEntries],
	);
	const visibleDocsFiles = useMemo(
		() =>
			query
				? allowedDocsFiles.filter((entry) => entry.path.toLocaleLowerCase().includes(query))
				: allowedDocsFiles,
		[allowedDocsFiles, query],
	);
	const allowedFiles = useMemo(
		() =>
			deduplicateEntries(
				filesEntries.filter((entry) => entry.kind === 'file' && isFileTreeFileGranted(filesAccess, entry.path)),
			),
		[filesAccess, filesEntries],
	);
	const visibleFiles = useMemo(
		() => (query ? allowedFiles.filter((entry) => entry.path.toLocaleLowerCase().includes(query)) : allowedFiles),
		[allowedFiles, query],
	);
	const databaseGroups = useMemo(() => groupDatabaseObjects(visibleTables), [visibleTables]);
	const docsNodes = useMemo(() => buildContextTree(visibleDocsFiles), [visibleDocsFiles]);
	const filesNodes = useMemo(() => buildContextTree(visibleFiles), [visibleFiles]);
	const mode =
		databaseAccess.mode === 'all' && docsAccess.mode === 'all' && filesAccess.mode === 'all'
			? 'Everything'
			: 'Specific selection';
	const databaseStatus = getCatalogIssueStatus(databaseCatalogState, databaseSyncState);
	const docsStatus = getCatalogIssueStatus(docsCatalogState, docsSyncState);
	const filesStatus = getCatalogIssueStatus(filesCatalogState, filesSyncState);
	const hasCurrentContext = allowedTables.length > 0 || allowedDocsFiles.length > 0 || allowedFiles.length > 0;
	const showDatabaseTree =
		Boolean(databaseStatus) || (searching ? visibleTables.length > 0 : allowedTables.length > 0);
	const showDocsTree = Boolean(docsStatus) || (searching ? visibleDocsFiles.length > 0 : allowedDocsFiles.length > 0);
	const showFilesTree = Boolean(filesStatus) || (searching ? visibleFiles.length > 0 : allowedFiles.length > 0);
	const showContextEmptyState = !searching && !hasCurrentContext && !databaseStatus && !docsStatus && !filesStatus;
	const showSearchEmptyState =
		searching &&
		!databaseStatus &&
		!docsStatus &&
		!filesStatus &&
		visibleTables.length === 0 &&
		visibleDocsFiles.length === 0 &&
		visibleFiles.length === 0;

	const toggleDatabaseFolder = (key: string) => {
		setExpandedDatabaseKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				removeExpandedSubtree(next, key, '\0');
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const toggleDocsFolder = (path: string) => {
		setExpandedDocsPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				removeExpandedSubtree(next, path, '/');
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const toggleFilesFolder = (path: string) => {
		setExpandedFilesPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				removeExpandedSubtree(next, path, '/');
			} else {
				next.add(path);
			}
			return next;
		});
	};

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant='secondary'>{mode}</Badge>
				<Badge variant='outline'>{databaseAccess.strict ? 'Strict' : 'Not strict'}</Badge>
				<span className='text-xs text-muted-foreground'>
					{formatCatalogCount(databaseCatalogState, allowedTables.length, 'table')} ·{' '}
					{formatCatalogCount(docsCatalogState, allowedDocsFiles.length, 'doc')} ·{' '}
					{formatCatalogCount(filesCatalogState, allowedFiles.length, 'file')}
				</span>
			</div>
			{hasCurrentContext && (
				<Input
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder='Search available tables, docs, and files'
					aria-label='Search effective context'
				/>
			)}
			<div data-testid='effective-context-tree' className='h-80 overflow-auto rounded-lg border'>
				<ul>
					{showDatabaseTree && (
						<DatabaseAccessTree
							groups={databaseGroups}
							catalogState={databaseCatalogState}
							syncState={databaseSyncState}
							searching={searching}
							expandedKeys={expandedDatabaseKeys}
							onToggle={toggleDatabaseFolder}
							onRetry={onRetryDatabaseCatalog}
						/>
					)}
					{showDocsTree && (
						<ContextAccessTree
							label='docs'
							statusLabel='Docs'
							panelId='effective-docs-root'
							nodes={docsNodes}
							catalogState={docsCatalogState}
							syncState={docsSyncState}
							searching={searching}
							expanded={docsExpanded}
							expandedPaths={expandedDocsPaths}
							onToggleRoot={() => setDocsExpanded((current) => !current)}
							onToggleFolder={toggleDocsFolder}
							onRetry={onRetryDocsCatalog}
						/>
					)}
					{showFilesTree && (
						<ContextAccessTree
							label='files'
							statusLabel='Files'
							panelId='effective-files-root'
							nodes={filesNodes}
							catalogState={filesCatalogState}
							syncState={filesSyncState}
							searching={searching}
							expanded={filesExpanded}
							expandedPaths={expandedFilesPaths}
							onToggleRoot={() => setFilesExpanded((current) => !current)}
							onToggleFolder={toggleFilesFolder}
							onRetry={onRetryFilesCatalog}
						/>
					)}
					{showContextEmptyState && <ContextEmptyState />}
					{showSearchEmptyState && <SearchEmptyState />}
				</ul>
			</div>
			{databaseAccess.mode === 'restricted' && databaseAccess.patterns.length > 0 && (
				<DynamicPatternSummary patterns={databaseAccess.patterns} objects={contextObjects} />
			)}
		</div>
	);
}

function DatabaseAccessTree({
	groups,
	catalogState,
	syncState,
	searching,
	expandedKeys,
	onToggle,
	onRetry,
}: {
	groups: DatabaseGroup[];
	catalogState: CatalogState;
	syncState: SyncState;
	searching: boolean;
	expandedKeys: Set<string>;
	onToggle: (key: string) => void;
	onRetry?: () => void;
}) {
	const status = getCatalogIssueStatus(catalogState, syncState);
	if (status) {
		return (
			<ContextStatusRow
				label='Database tables'
				status={status}
				onRetry={catalogState === 'error' ? onRetry : undefined}
			/>
		);
	}
	if (groups.length === 0) {
		return null;
	}

	return (
		<>
			{groups.map((group) =>
				group.schemas.length === 1 ? (
					<DatabaseSchemaNode
						key={group.schemas[0].key}
						schema={group.schemas[0]}
						label={`${group.database}/${group.schemas[0].schema}`}
						databaseType={group.databaseType}
						depth={0}
						searching={searching}
						expandedKeys={expandedKeys}
						onToggle={onToggle}
					/>
				) : (
					<DatabaseNode
						key={group.key}
						group={group}
						searching={searching}
						expandedKeys={expandedKeys}
						onToggle={onToggle}
					/>
				),
			)}
		</>
	);
}

function DatabaseNode({
	group,
	searching,
	expandedKeys,
	onToggle,
}: {
	group: DatabaseGroup;
	searching: boolean;
	expandedKeys: Set<string>;
	onToggle: (key: string) => void;
}) {
	const open = searching || expandedKeys.has(group.key);
	const panelId = `effective-database-${toDomId(group.key)}`;

	return (
		<li>
			<FolderButton
				label={group.database}
				open={open}
				depth={0}
				panelId={panelId}
				badge={group.databaseType}
				onClick={() => onToggle(group.key)}
			/>
			{open && (
				<ul id={panelId}>
					{group.schemas.map((schema) => (
						<DatabaseSchemaNode
							key={schema.key}
							schema={schema}
							label={schema.schema}
							depth={1}
							searching={searching}
							expandedKeys={expandedKeys}
							onToggle={onToggle}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function DatabaseSchemaNode({
	schema,
	label,
	databaseType,
	depth,
	searching,
	expandedKeys,
	onToggle,
}: {
	schema: DatabaseSchemaGroup;
	label: string;
	databaseType?: string;
	depth: number;
	searching: boolean;
	expandedKeys: Set<string>;
	onToggle: (key: string) => void;
}) {
	const open = searching || expandedKeys.has(schema.key);
	const panelId = `effective-schema-${toDomId(schema.key)}`;

	return (
		<li>
			<FolderButton
				label={label}
				open={open}
				depth={depth}
				panelId={panelId}
				badge={databaseType}
				onClick={() => onToggle(schema.key)}
			/>
			{open && (
				<ul id={panelId}>
					{schema.tables.map((table) => (
						<li
							key={databaseObjectKey(table)}
							className='flex h-8 items-center gap-1 pr-3 text-sm'
							style={{ paddingLeft: `${getTreeNodePadding(depth + 1)}px` }}
						>
							<span className='size-4 shrink-0' />
							<FileExplorerIcon name={table.table} type='table' />
							<span className='min-w-0 flex-1 truncate' title={table.table}>
								{table.table}
							</span>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

function ContextAccessTree({
	label,
	statusLabel,
	panelId,
	nodes,
	catalogState,
	syncState,
	searching,
	expanded,
	expandedPaths,
	onToggleRoot,
	onToggleFolder,
	onRetry,
}: {
	label: string;
	statusLabel: string;
	panelId: string;
	nodes: ContextTreeNode[];
	catalogState: CatalogState;
	syncState: SyncState;
	searching: boolean;
	expanded: boolean;
	expandedPaths: Set<string>;
	onToggleRoot: () => void;
	onToggleFolder: (path: string) => void;
	onRetry?: () => void;
}) {
	const status = getCatalogIssueStatus(catalogState, syncState);
	if (status) {
		return (
			<ContextStatusRow
				label={statusLabel}
				status={status}
				onRetry={catalogState === 'error' ? onRetry : undefined}
			/>
		);
	}
	if (nodes.length === 0) {
		return null;
	}
	const open = searching || expanded;

	return (
		<li>
			<FolderButton label={label} open={open} depth={0} panelId={panelId} onClick={onToggleRoot} />
			{open && (
				<ul id={panelId}>
					{nodes.map((node) => (
						<ContextNode
							key={node.path}
							label={label}
							node={node}
							depth={1}
							searching={searching}
							expandedPaths={expandedPaths}
							onToggle={onToggleFolder}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function ContextNode({
	label,
	node,
	depth,
	searching,
	expandedPaths,
	onToggle,
}: {
	label: string;
	node: ContextTreeNode;
	depth: number;
	searching: boolean;
	expandedPaths: Set<string>;
	onToggle: (path: string) => void;
}) {
	if (node.kind === 'file') {
		return (
			<li
				className='flex h-8 items-center gap-1 pr-3 text-sm'
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				<span className='size-4 shrink-0' />
				<FileExplorerIcon name={node.name} type='file' />
				<span className='min-w-0 flex-1 truncate' title={node.path}>
					{node.name}
				</span>
			</li>
		);
	}

	const open = searching || expandedPaths.has(node.path);
	const panelId = `effective-${label}-folder-${toDomId(node.path)}`;
	return (
		<li>
			<FolderButton
				label={node.name}
				open={open}
				depth={depth}
				panelId={panelId}
				onClick={() => onToggle(node.path)}
			/>
			{open && (
				<ul id={panelId}>
					{node.children.map((child) => (
						<ContextNode
							key={child.path}
							label={label}
							node={child}
							depth={depth + 1}
							searching={searching}
							expandedPaths={expandedPaths}
							onToggle={onToggle}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FolderButton({
	label,
	open,
	depth,
	panelId,
	badge,
	onClick,
}: {
	label: string;
	open: boolean;
	depth: number;
	panelId: string;
	badge?: string;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			className='flex h-8 w-full cursor-pointer items-center gap-1 pr-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
			style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			aria-label={`${open ? 'Collapse' : 'Expand'} ${label} folder`}
			aria-expanded={open}
			aria-controls={panelId}
			onClick={onClick}
		>
			<ChevronRight
				className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
			/>
			<FileExplorerIcon name={label} type='directory' />
			<span className='min-w-0 flex-1 truncate' title={label}>
				{label}
			</span>
			{badge && (
				<Badge variant='secondary' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
					{badge}
				</Badge>
			)}
		</button>
	);
}

function ContextStatusRow({ label, status, onRetry }: { label: string; status: string; onRetry?: () => void }) {
	return (
		<li className='flex h-9 items-center gap-2 border-b px-3 text-sm last:border-b-0'>
			<span className='min-w-0 flex-1 truncate font-medium'>{label}</span>
			<span className={cn('text-xs text-muted-foreground', status === 'Failed to load' && 'text-destructive')}>
				{status}
			</span>
			{onRetry && (
				<Button
					type='button'
					size='sm'
					variant='ghost'
					className='h-6 px-2 text-xs'
					aria-label={`Retry ${label.toLocaleLowerCase()}`}
					onClick={onRetry}
				>
					Retry
				</Button>
			)}
		</li>
	);
}

function SearchEmptyState() {
	return <ContextEmptyState message='No matches' />;
}

function ContextEmptyState({ message = 'No context available' }: { message?: string }) {
	return <li className='flex items-center justify-center px-4 py-6 text-sm text-muted-foreground'>{message}</li>;
}

function DynamicPatternSummary({ patterns, objects }: { patterns: string[]; objects: DatabaseContextObject[] }) {
	return (
		<div className='flex flex-col gap-2 border-t pt-4'>
			<div>
				<h4 className='text-sm font-medium'>Dynamic table patterns</h4>
				<p className='text-xs text-muted-foreground'>Future matching tables will also be available.</p>
			</div>
			<ul className='flex flex-wrap gap-2'>
				{patterns.map((pattern) => {
					const matchCount = countPatternMatches(pattern, objects);
					return (
						<li key={pattern}>
							<Badge variant='secondary' className='gap-1.5 font-normal'>
								<span className='font-mono'>{pattern}</span>
								<span className='text-muted-foreground'>
									{matchCount} {matchCount === 1 ? 'match' : 'matches'}
								</span>
							</Badge>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function deduplicateTables(objects: DatabaseContextObject[]): DatabaseContextObject[] {
	return [...new Map(objects.map((object) => [databaseObjectKey(object), object])).values()];
}

function deduplicateEntries(entries: readonly ContextTreeEntry[]): ContextTreeEntry[] {
	return [...new Map(entries.map((entry) => [entry.path, entry])).values()];
}

function groupDatabaseObjects(objects: DatabaseContextObject[]): DatabaseGroup[] {
	const databases = new Map<string, DatabaseGroup & { schemaMap: Map<string, DatabaseSchemaGroup> }>();
	for (const object of objects) {
		const databaseKey = [object.databaseType, object.database].join('\0');
		const database = databases.get(databaseKey) ?? {
			key: databaseKey,
			databaseType: object.databaseType,
			database: object.database,
			schemas: [],
			schemaMap: new Map<string, DatabaseSchemaGroup>(),
		};
		const schemaKey = [databaseKey, object.schema].join('\0');
		const schema = database.schemaMap.get(schemaKey) ?? { key: schemaKey, schema: object.schema, tables: [] };
		schema.tables.push(object);
		database.schemaMap.set(schemaKey, schema);
		databases.set(databaseKey, database);
	}
	return [...databases.values()].map(({ schemaMap, ...database }) => ({
		...database,
		schemas: [...schemaMap.values()],
	}));
}

function buildContextTree(entries: readonly ContextTreeEntry[]): ContextTreeNode[] {
	const nodes = new Map<string, ContextTreeNode>();
	for (const entry of entries) {
		const segments = entry.path.split('/');
		for (let index = 0; index < segments.length; index++) {
			const path = segments.slice(0, index + 1).join('/');
			const kind = index === segments.length - 1 ? 'file' : 'folder';
			if (!nodes.has(path)) {
				nodes.set(path, { kind, path, name: segments[index], children: [] });
			}
		}
	}
	for (const node of nodes.values()) {
		const separatorIndex = node.path.lastIndexOf('/');
		if (separatorIndex !== -1) {
			nodes.get(node.path.slice(0, separatorIndex))?.children.push(node);
		}
	}
	for (const node of nodes.values()) {
		node.children.sort(compareContextNodes);
	}
	return [...nodes.values()].filter((node) => !node.path.includes('/')).sort(compareContextNodes);
}

function getCatalogIssueStatus(catalogState: CatalogState, syncState: SyncState): string {
	if (catalogState === 'loading') {
		return 'Loading...';
	}
	if (catalogState === 'error') {
		return 'Failed to load';
	}
	if (syncState === 'missing') {
		return 'Not synced';
	}
	return '';
}

function compareContextNodes(left: ContextTreeNode, right: ContextTreeNode): number {
	return Number(right.kind === 'folder') - Number(left.kind === 'folder') || left.name.localeCompare(right.name);
}

function databaseObjectKey(object: DatabaseContextObject): string {
	return [object.databaseType, object.database, object.schema, object.table].join('\0');
}

function countPatternMatches(pattern: string, objects: DatabaseContextObject[]): number {
	return new Set(objects.filter((object) => matchesDatabaseContextPattern(pattern, object)).map(databaseObjectKey))
		.size;
}

function formatCount(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatCatalogCount(state: CatalogState, count: number, singular: string): string {
	if (state === 'loading') {
		return `Loading ${singular}s...`;
	}
	if (state === 'error') {
		return `${singular[0].toLocaleUpperCase()}${singular.slice(1)}s unavailable`;
	}
	return formatCount(count, singular);
}

function toDomId(value: string): string {
	return encodeURIComponent(value).replaceAll('%', '-');
}
