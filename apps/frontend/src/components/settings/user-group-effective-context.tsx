import { isDatabaseContextTableGranted, isDocsContextFileGranted, matchesDatabaseContextPattern } from '@nao/shared';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DatabaseContextAccess, DocsContextAccess } from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

type CatalogState = 'loading' | 'error' | 'ready';
type SyncState = 'missing' | 'ready';

interface UserGroupEffectiveContextProps {
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	contextObjects: DatabaseContextObject[];
	docsEntries: DocsContextCatalogEntry[];
	databaseCatalogState?: CatalogState;
	docsCatalogState?: CatalogState;
	databaseSyncState?: SyncState;
	docsSyncState?: SyncState;
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

interface DocsTreeNode {
	kind: 'folder' | 'file';
	path: string;
	name: string;
	children: DocsTreeNode[];
}

export function UserGroupEffectiveContext({
	databaseAccess,
	docsAccess,
	contextObjects,
	docsEntries,
	databaseCatalogState = 'ready',
	docsCatalogState = 'ready',
	databaseSyncState = 'ready',
	docsSyncState = 'ready',
}: UserGroupEffectiveContextProps) {
	const [search, setSearch] = useState('');
	const [expandedDatabaseKeys, setExpandedDatabaseKeys] = useState<Set<string>>(new Set());
	const [expandedDocsPaths, setExpandedDocsPaths] = useState<Set<string>>(new Set());
	const [docsExpanded, setDocsExpanded] = useState(false);
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
			deduplicateDocsFiles(
				docsEntries.filter(
					(entry) => entry.kind === 'file' && isDocsContextFileGranted(docsAccess, entry.path),
				),
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
	const databaseGroups = useMemo(() => groupDatabaseObjects(visibleTables), [visibleTables]);
	const docsNodes = useMemo(() => buildDocsTree(visibleDocsFiles), [visibleDocsFiles]);
	const mode = databaseAccess.mode === 'all' && docsAccess.mode === 'all' ? 'Everything' : 'Specific selection';
	const databaseStatus = getCatalogIssueStatus(databaseCatalogState, databaseSyncState);
	const docsStatus = getCatalogIssueStatus(docsCatalogState, docsSyncState);
	const hasCurrentContext = allowedTables.length > 0 || allowedDocsFiles.length > 0;
	const showDatabaseTree =
		Boolean(databaseStatus) || (searching ? visibleTables.length > 0 : allowedTables.length > 0);
	const showDocsTree = Boolean(docsStatus) || (searching ? visibleDocsFiles.length > 0 : allowedDocsFiles.length > 0);
	const showContextEmptyState = !searching && !hasCurrentContext && !databaseStatus && !docsStatus;
	const showSearchEmptyState =
		searching && !databaseStatus && !docsStatus && visibleTables.length === 0 && visibleDocsFiles.length === 0;

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

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant='secondary'>{mode}</Badge>
				<Badge variant='outline'>{databaseAccess.strict ? 'Strict' : 'Not strict'}</Badge>
				<span className='text-xs text-muted-foreground'>
					{formatCount(allowedTables.length, 'table')} · {formatCount(allowedDocsFiles.length, 'doc')}
				</span>
			</div>
			{hasCurrentContext && (
				<Input
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder='Search available tables and docs'
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
						/>
					)}
					{showDocsTree && (
						<DocsAccessTree
							nodes={docsNodes}
							catalogState={docsCatalogState}
							syncState={docsSyncState}
							searching={searching}
							expanded={docsExpanded}
							expandedPaths={expandedDocsPaths}
							onToggleRoot={() => setDocsExpanded((current) => !current)}
							onToggleFolder={toggleDocsFolder}
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
}: {
	groups: DatabaseGroup[];
	catalogState: CatalogState;
	syncState: SyncState;
	searching: boolean;
	expandedKeys: Set<string>;
	onToggle: (key: string) => void;
}) {
	const status = getCatalogIssueStatus(catalogState, syncState);
	if (status) {
		return <ContextStatusRow label='Database tables' status={status} />;
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

function DocsAccessTree({
	nodes,
	catalogState,
	syncState,
	searching,
	expanded,
	expandedPaths,
	onToggleRoot,
	onToggleFolder,
}: {
	nodes: DocsTreeNode[];
	catalogState: CatalogState;
	syncState: SyncState;
	searching: boolean;
	expanded: boolean;
	expandedPaths: Set<string>;
	onToggleRoot: () => void;
	onToggleFolder: (path: string) => void;
}) {
	const status = getCatalogIssueStatus(catalogState, syncState);
	if (status) {
		return <ContextStatusRow label='Docs' status={status} />;
	}
	if (nodes.length === 0) {
		return null;
	}
	const open = searching || expanded;
	const panelId = 'effective-docs-root';

	return (
		<li>
			<FolderButton label='docs' open={open} depth={0} panelId={panelId} onClick={onToggleRoot} />
			{open && (
				<ul id={panelId}>
					{nodes.map((node) => (
						<DocsNode
							key={node.path}
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

function DocsNode({
	node,
	depth,
	searching,
	expandedPaths,
	onToggle,
}: {
	node: DocsTreeNode;
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
	const panelId = `effective-docs-${toDomId(node.path)}`;
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
						<DocsNode
							key={child.path}
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
			className='flex h-8 w-full items-center gap-1 pr-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
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

function ContextStatusRow({ label, status }: { label: string; status: string }) {
	return (
		<li className='flex h-9 items-center gap-2 border-b px-3 text-sm last:border-b-0'>
			<span className='min-w-0 flex-1 truncate font-medium'>{label}</span>
			<span className={cn('text-xs text-muted-foreground', status === 'Failed to load' && 'text-destructive')}>
				{status}
			</span>
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

function deduplicateDocsFiles(entries: DocsContextCatalogEntry[]): DocsContextCatalogEntry[] {
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

function buildDocsTree(entries: DocsContextCatalogEntry[]): DocsTreeNode[] {
	const nodes = new Map<string, DocsTreeNode>();
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
		node.children.sort(compareDocsNodes);
	}
	return [...nodes.values()].filter((node) => !node.path.includes('/')).sort(compareDocsNodes);
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

function compareDocsNodes(left: DocsTreeNode, right: DocsTreeNode): number {
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

function toDomId(value: string): string {
	return encodeURIComponent(value).replaceAll('%', '-');
}
