import { EMPTY_PROJECT_ROW_SECURITY, normalizeProjectRowSecurity, rowSecurityTableKey } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectRowSecurity, SensitiveTableDefinition } from '@nao/shared';
import type { Dispatch, SetStateAction } from 'react';

import type {
	DatabaseContextObject,
	GroupedDatabase,
	GroupedSchema,
} from '@/components/settings/user-group-context-access';
import { groupDatabaseContextObjects } from '@/components/settings/user-group-context-access';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { useLicenseFeatures } from '@/hooks/use-license';
import { getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type RowSecurityDialog = { mode: 'add' } | { mode: 'edit'; definition: SensitiveTableDefinition };

export function ProjectRowSecurity({
	objects,
	catalogState = 'ready',
	onRetryCatalog,
}: {
	objects: DatabaseContextObject[];
	catalogState?: 'loading' | 'error' | 'ready';
	onRetryCatalog?: () => void;
}) {
	const rowSecurity = useQuery(trpc.userGroup.rowSecurity.queryOptions());
	const license = useLicenseFeatures();
	const queryClient = useQueryClient();
	const update = useMutation(
		trpc.userGroup.updateRowSecurity.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.userGroup.rowSecurity.queryKey() });
			},
		}),
	);
	const [dialog, setDialog] = useState<RowSecurityDialog | null>(null);
	const [dialogDraft, setDialogDraft] = useState<ProjectRowSecurity>(EMPTY_PROJECT_ROW_SECURITY);
	const [search, setSearch] = useState('');
	const [manualExpandedKeys, setManualExpandedKeys] = useState<Set<string>>(() => new Set());
	const [removeTarget, setRemoveTarget] = useState<SensitiveTableDefinition | null>(null);
	const isLicensed = license.data?.['row-level-security'] === true;
	const registry = normalizeProjectRowSecurity(rowSecurity.data ?? EMPTY_PROJECT_ROW_SECURITY);
	const visibleObjects = useMemo(() => filterRowSecurityObjects(objects, search), [objects, search]);
	const unavailable =
		rowSecurity.isLoading || rowSecurity.isError || catalogState !== 'ready'
			? []
			: getUnavailableDefinitions(registry, objects);
	const unavailableByTable = new Map(unavailable.map((definition) => [rowSecurityTableKey(definition), definition]));
	const columnCount = registry.tables.reduce((total, table) => total + table.constraintColumns.length, 0);
	const draftColumnCount = dialogDraft.tables.reduce((total, table) => total + table.constraintColumns.length, 0);
	const dialogUnavailable = catalogState === 'ready' ? getUnavailableDefinitions(dialogDraft, objects) : [];

	const openAddDialog = () => {
		setDialogDraft(cloneRowSecurity(registry));
		setSearch('');
		setManualExpandedKeys(new Set());
		setDialog({ mode: 'add' });
	};

	const openEditDialog = (definition: SensitiveTableDefinition) => {
		setDialogDraft(cloneRowSecurity(registry));
		setDialog({
			mode: 'edit',
			definition: cloneSensitiveTableDefinition(definition),
		});
	};

	const saveDialog = () => {
		if (!dialog) {
			return;
		}
		const nextRegistry =
			dialog.mode === 'add'
				? normalizeProjectRowSecurity(dialogDraft)
				: updateDefinition(dialogDraft, dialog.definition, dialog.definition);
		update.mutate(nextRegistry, {
			onSuccess: () => {
				setDialog(null);
			},
		});
	};

	const removeTable = () => {
		if (!removeTarget) {
			return;
		}
		const nextRegistry = updateDefinition(registry, removeTarget);
		update.mutate(nextRegistry, {
			onSuccess: () => {
				setRemoveTarget(null);
			},
		});
	};

	return (
		<>
			<SettingsCard
				title='Row-level security'
				description='Protect tables by choosing the columns that group policies should use.'
				action={!isLicensed ? <UpgradeToEnterprise /> : undefined}
				unstyled
			>
				{!isLicensed && registry.tables.length > 0 && (
					<p className='text-xs text-muted-foreground'>
						Queries on protected tables are blocked until the license is restored. Remove tables to unblock
						them.
					</p>
				)}
				<div className='flex items-center justify-between gap-3'>
					<Badge variant='secondary' className='shrink-0'>
						{registry.tables.length} {registry.tables.length === 1 ? 'table' : 'tables'} · {columnCount}{' '}
						{columnCount === 1 ? 'column' : 'columns'}
					</Badge>
					<Button
						type='button'
						disabled={!isLicensed || rowSecurity.isLoading || rowSecurity.isError}
						onClick={openAddDialog}
					>
						<Plus />
						Add protected table
					</Button>
				</div>
				<div className='overflow-hidden rounded-lg border' role='region' aria-label='Protected tables'>
					{rowSecurity.isLoading ? (
						<StatusRow status='Loading security settings...' />
					) : rowSecurity.isError ? (
						<StatusRow
							status='Failed to load security settings'
							onRetry={() => void rowSecurity.refetch()}
						/>
					) : registry.tables.length === 0 ? (
						<div className='flex flex-col items-center gap-2 px-4 py-8 text-center'>
							<p className='text-sm font-medium'>No protected tables</p>
							<p className='max-w-md text-xs text-muted-foreground'>
								Add a table and choose its constraint columns to make row-level policies available to
								user groups.
							</p>
							<Button
								type='button'
								size='sm'
								variant='outline'
								className='rounded-full'
								disabled={!isLicensed}
								onClick={openAddDialog}
							>
								Add protected table
							</Button>
						</div>
					) : (
						<div className='divide-y'>
							{registry.tables.map((definition) => (
								<ProtectedTableSummary
									key={rowSecurityTableKey(definition)}
									definition={definition}
									object={objects.find(
										(object) => rowSecurityTableKey(object) === rowSecurityTableKey(definition),
									)}
									unavailable={unavailableByTable.get(rowSecurityTableKey(definition))}
									editDisabled={!isLicensed}
									onEdit={() => openEditDialog(definition)}
									onRemove={() => setRemoveTarget(definition)}
								/>
							))}
						</div>
					)}
				</div>
				{catalogState === 'loading' && !rowSecurity.isLoading && (
					<p className='text-xs text-muted-foreground'>Loading synced tables...</p>
				)}
				{catalogState === 'error' && !rowSecurity.isLoading && (
					<div className='flex items-center justify-between gap-2 text-xs text-destructive'>
						<span>Failed to load synced tables</span>
						{onRetryCatalog && (
							<Button
								type='button'
								size='sm'
								variant='ghost'
								className='rounded-full'
								onClick={onRetryCatalog}
							>
								Retry
							</Button>
						)}
					</div>
				)}
			</SettingsCard>

			<Dialog
				open={dialog !== null}
				onOpenChange={(open) => {
					if (!open && !update.isPending) {
						setDialog(null);
					}
				}}
			>
				{dialog?.mode === 'add' ? (
					<DialogContent className='grid h-[min(46rem,calc(100vh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-3xl'>
						<DialogHeader>
							<DialogTitle>Add protected tables</DialogTitle>
							<DialogDescription>
								Expand a table and select the columns that group policies should use. Until a group gets
								a policy for a protected table, its members see no rows from it, admins included.
							</DialogDescription>
						</DialogHeader>
						<div className='flex items-center gap-2'>
							<Input
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder='Search databases, schemas, tables, and columns'
								aria-label='Search row-level security tables'
								autoFocus
							/>
							<Badge variant='secondary' className='shrink-0'>
								{dialogDraft.tables.length} {dialogDraft.tables.length === 1 ? 'table' : 'tables'} ·{' '}
								{draftColumnCount} {draftColumnCount === 1 ? 'column' : 'columns'}
							</Badge>
						</div>
						<div className='min-h-0 overflow-auto rounded-lg border'>
							{catalogState === 'loading' ? (
								<StatusRow status='Loading synced tables...' />
							) : catalogState === 'error' ? (
								<StatusRow status='Failed to load synced tables' onRetry={onRetryCatalog} />
							) : (
								<>
									{visibleObjects.length === 0 ? (
										<StatusRow
											status={search ? 'No matching tables or columns.' : 'No synced tables.'}
										/>
									) : (
										<RowSecurityTree
											objects={visibleObjects}
											search={search}
											draft={dialogDraft}
											manualExpandedKeys={manualExpandedKeys}
											onManualExpandedKeysChange={setManualExpandedKeys}
											onChange={setDialogDraft}
										/>
									)}
									{search.trim() === '' && dialogUnavailable.length > 0 && (
										<UnavailableDraftSelections
											definitions={dialogUnavailable}
											onRemove={(definition) =>
												setDialogDraft((current) =>
													removeUnavailableSelection(current, definition),
												)
											}
										/>
									)}
								</>
							)}
						</div>
						<DialogActions
							isPending={update.isPending}
							error={update.error}
							onCancel={() => setDialog(null)}
							onSave={saveDialog}
						/>
					</DialogContent>
				) : dialog?.mode === 'edit' ? (
					<DialogContent className='sm:max-w-xl'>
						<DialogHeader>
							<DialogTitle>Edit protected table</DialogTitle>
							<DialogDescription>
								Choose the columns that group policies should use for this table.
							</DialogDescription>
						</DialogHeader>
						<EditTableSelector
							definition={dialog.definition}
							object={objects.find(
								(object) => rowSecurityTableKey(object) === rowSecurityTableKey(dialog.definition),
							)}
							catalogState={catalogState}
							onRetryCatalog={onRetryCatalog}
							onChange={(definition) =>
								setDialog((current) =>
									current?.mode === 'edit' ? { ...current, definition } : current,
								)
							}
						/>
						{dialog.definition.constraintColumns.length === 0 && (
							<p className='text-sm text-muted-foreground'>
								Select at least one constraint column to save.
							</p>
						)}
						<DialogActions
							isPending={update.isPending}
							error={update.error}
							saveDisabled={dialog.definition.constraintColumns.length === 0}
							onCancel={() => setDialog(null)}
							onSave={saveDialog}
						/>
					</DialogContent>
				) : null}
			</Dialog>

			<ConfirmationDialog
				open={removeTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRemoveTarget(null);
					}
				}}
				title='Remove protected table?'
				description={
					removeTarget
						? `${removeTarget.database}/${removeTarget.schema}/${removeTarget.table} will no longer be available for row-level group policies.`
						: ''
				}
				confirmLabel='Remove'
				onConfirm={removeTable}
				isPending={update.isPending}
				error={update.error?.message}
				preventCloseWhilePending
			/>
		</>
	);
}

function ProtectedTableSummary({
	definition,
	object,
	unavailable,
	editDisabled,
	onEdit,
	onRemove,
}: {
	definition: SensitiveTableDefinition;
	object?: DatabaseContextObject;
	unavailable?: SensitiveTableDefinition;
	editDisabled: boolean;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const missingColumns = new Set(unavailable?.constraintColumns ?? []);
	const isTableUnavailable = object === undefined;
	return (
		<div className='flex items-start gap-3 p-3'>
			<FileExplorerIcon name={definition.table} type='table' />
			<div className='min-w-0 flex-1'>
				<div className='flex flex-wrap items-center gap-2'>
					<p className='truncate text-sm font-medium'>
						{definition.database}/{definition.schema}/{definition.table}
					</p>
					{isTableUnavailable && <Badge variant='destructive'>Unavailable</Badge>}
				</div>
				<div className='mt-1.5 flex flex-wrap gap-1.5'>
					{definition.constraintColumns.map((column) => (
						<Badge
							key={column}
							variant={missingColumns.has(column) ? 'outline' : 'secondary'}
							className={cn(missingColumns.has(column) && 'border-destructive/40 text-destructive')}
						>
							{column}
							{missingColumns.has(column) && <span className='sr-only'> unavailable</span>}
						</Badge>
					))}
				</div>
				{unavailable && !isTableUnavailable && (
					<p className='mt-1.5 text-xs text-destructive'>Some saved columns are unavailable after sync.</p>
				)}
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					type='button'
					size='icon-sm'
					variant='ghost'
					className='rounded-full'
					aria-label={`Edit ${definition.table}`}
					disabled={editDisabled}
					onClick={onEdit}
				>
					<Pencil />
				</Button>
				<Button
					type='button'
					size='icon-sm'
					variant='ghost'
					className='rounded-full'
					aria-label={`Remove ${definition.table}`}
					onClick={onRemove}
				>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

function EditTableSelector({
	definition,
	object,
	catalogState,
	onRetryCatalog,
	onChange,
}: {
	definition: SensitiveTableDefinition;
	object?: DatabaseContextObject;
	catalogState: 'loading' | 'error' | 'ready';
	onRetryCatalog?: () => void;
	onChange: (definition: SensitiveTableDefinition) => void;
}) {
	const selected = new Set(definition.constraintColumns);
	const syncedColumns = object?.columns ?? [];
	const unavailableColumns = new Set(
		catalogState === 'ready'
			? definition.constraintColumns.filter((column) => !syncedColumns.includes(column))
			: [],
	);
	const columns = [...new Set([...syncedColumns, ...definition.constraintColumns])];
	const tablePath = `${definition.database}/${definition.schema}/${definition.table}`;

	return (
		<div className='overflow-hidden rounded-lg border'>
			<div className='flex items-center gap-2 border-b px-3 py-2.5'>
				<FileExplorerIcon name={definition.table} type='table' />
				<span className='min-w-0 flex-1 truncate text-sm font-medium'>{tablePath}</span>
				{catalogState === 'ready' && !object && <Badge variant='destructive'>Unavailable</Badge>}
			</div>
			{catalogState === 'loading' && <StatusRow status='Loading synced table...' />}
			{catalogState === 'error' && <StatusRow status='Failed to load synced table.' onRetry={onRetryCatalog} />}
			{catalogState === 'ready' && !object && (
				<p className='border-b px-3 py-2 text-xs text-muted-foreground'>
					This table was not found in the latest sync. Use Remove outside this dialog to stop protecting it.
				</p>
			)}
			{columns.length === 0 ? (
				catalogState === 'ready' && <StatusRow status='No synced columns available.' />
			) : (
				<div className='py-1'>
					{columns.map((column) => {
						const unavailable = unavailableColumns.has(column);
						return (
							<label
								key={column}
								className='flex h-9 cursor-pointer items-center gap-2 px-3 text-sm hover:bg-muted/50'
							>
								<Checkbox
									checked={selected.has(column)}
									aria-label={`${column} constraint column for ${definition.table}`}
									onCheckedChange={(checked) => {
										const constraintColumns = checked
											? [...selected, column]
											: [...selected].filter((selectedColumn) => selectedColumn !== column);
										onChange({
											...definition,
											constraintColumns: constraintColumns.sort(),
										});
									}}
								/>
								<span className='min-w-0 flex-1 truncate'>{column}</span>
								{unavailable && (
									<Badge variant='outline' className='text-muted-foreground'>
										Unavailable
									</Badge>
								)}
							</label>
						);
					})}
				</div>
			)}
		</div>
	);
}

function DialogActions({
	isPending,
	error,
	saveDisabled = false,
	onCancel,
	onSave,
}: {
	isPending: boolean;
	error: { message: string } | null;
	saveDisabled?: boolean;
	onCancel: () => void;
	onSave: () => void;
}) {
	return (
		<div>
			{error && <p className='mb-2 text-sm text-destructive'>{error.message}</p>}
			<DialogFooter>
				<Button
					type='button'
					variant='ghost'
					className='rounded-full border'
					disabled={isPending}
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button
					type='button'
					variant='primary-gradient'
					className='rounded-full'
					disabled={saveDisabled}
					isLoading={isPending}
					onClick={onSave}
				>
					Save
				</Button>
			</DialogFooter>
		</div>
	);
}

function UnavailableDraftSelections({
	definitions,
	onRemove,
}: {
	definitions: SensitiveTableDefinition[];
	onRemove: (definition: SensitiveTableDefinition) => void;
}) {
	return (
		<div className='border-t p-3'>
			<p className='text-sm font-medium'>Unavailable saved selections</p>
			<p className='mb-2 text-xs text-muted-foreground'>
				These tables or columns were not found in the latest sync.
			</p>
			{definitions.map((definition) => (
				<div key={rowSecurityTableKey(definition)} className='flex items-center gap-2 py-1 text-xs'>
					<span className='min-w-0 flex-1 truncate'>
						{definition.database}/{definition.schema}/{definition.table}:{' '}
						{definition.constraintColumns.join(', ')}
					</span>
					<Button
						type='button'
						size='icon-sm'
						variant='ghost'
						className='rounded-full'
						aria-label={`Remove unavailable selections from ${definition.table}`}
						onClick={() => onRemove(definition)}
					>
						<Trash2 />
					</Button>
				</div>
			))}
		</div>
	);
}

function RowSecurityTree({
	objects,
	search,
	draft,
	manualExpandedKeys,
	onManualExpandedKeysChange,
	onChange,
}: {
	objects: DatabaseContextObject[];
	search: string;
	draft: ProjectRowSecurity;
	manualExpandedKeys: Set<string>;
	onManualExpandedKeysChange: Dispatch<SetStateAction<Set<string>>>;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const databases = useMemo(() => groupDatabaseContextObjects(objects), [objects]);
	const autoExpandedKeys = useMemo(() => getRowSecuritySearchExpandedKeys(databases, search), [databases, search]);
	const expandedKeys = useMemo(
		() => new Set([...manualExpandedKeys, ...autoExpandedKeys]),
		[manualExpandedKeys, autoExpandedKeys],
	);

	const toggleFolder = (folder: GroupedDatabase | GroupedSchema) => {
		onManualExpandedKeysChange((current) => {
			const next = new Set(current);
			if (current.has(folder.key)) {
				removeExpandedSubtree(next, folder.key, '\0');
			} else {
				next.add(folder.key);
			}
			return next;
		});
	};

	const toggleTable = (object: DatabaseContextObject) => {
		const key = rowSecurityTableKey(object);
		onManualExpandedKeysChange((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	return (
		<ul data-testid='project-row-security-tree'>
			{databases.map((database) => (
				<RowSecurityDatabaseNode
					key={database.key}
					database={database}
					draft={draft}
					expandedKeys={expandedKeys}
					onToggleFolder={toggleFolder}
					onToggleTable={toggleTable}
					onChange={onChange}
				/>
			))}
		</ul>
	);
}

function RowSecurityDatabaseNode({
	database,
	draft,
	expandedKeys,
	onToggleFolder,
	onToggleTable,
	onChange,
}: {
	database: GroupedDatabase;
	draft: ProjectRowSecurity;
	expandedKeys: Set<string>;
	onToggleFolder: (folder: GroupedDatabase | GroupedSchema) => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const open = expandedKeys.has(database.key);
	const panelId = `row-security-database-${toDomId(database.key)}`;
	const configuredCount = getConfiguredDatabaseTableCount(draft, database);
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
				style={{ paddingLeft: `${getTreeNodePadding(0)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${database.database} database`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => onToggleFolder(database)}
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon name={database.database} type='directory' />
				<span className='min-w-0 flex-1 truncate font-medium'>{database.database}</span>
				{configuredCount > 0 && (
					<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
						{configuredCount} configured
					</Badge>
				)}
				<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
					{database.databaseType}
				</Badge>
			</button>
			{open && (
				<ul id={panelId}>
					{database.schemas.map((schema) => (
						<RowSecuritySchemaNode
							key={schema.key}
							schema={schema}
							label={schema.schema}
							depth={1}
							open={expandedKeys.has(schema.key)}
							draft={draft}
							expandedKeys={expandedKeys}
							onToggle={() => onToggleFolder(schema)}
							onToggleTable={onToggleTable}
							onChange={onChange}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function RowSecuritySchemaNode({
	schema,
	label,
	depth,
	open,
	draft,
	expandedKeys,
	onToggle,
	onToggleTable,
	onChange,
}: {
	schema: GroupedSchema;
	label: string;
	depth: number;
	open: boolean;
	draft: ProjectRowSecurity;
	expandedKeys: Set<string>;
	onToggle: () => void;
	onToggleTable: (object: DatabaseContextObject) => void;
	onChange: (rowSecurity: ProjectRowSecurity) => void;
}) {
	const panelId = `row-security-schema-${toDomId(schema.key)}`;
	const configuredCount = getConfiguredTableCount(draft, schema);
	return (
		<li>
			<button
				type='button'
				className='flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50'
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${label} schema`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
				/>
				<FileExplorerIcon name={schema.schema} type='directory' />
				<span className='min-w-0 flex-1 truncate'>{label}</span>
				{configuredCount > 0 && (
					<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
						{configuredCount} configured
					</Badge>
				)}
			</button>
			{open && (
				<ul id={panelId}>
					{schema.tables.map((object) => (
						<SensitiveTableRow
							key={rowSecurityTableKey(object)}
							object={object}
							depth={depth + 1}
							open={expandedKeys.has(rowSecurityTableKey(object))}
							definition={draft.tables.find(
								(table) => rowSecurityTableKey(table) === rowSecurityTableKey(object),
							)}
							onToggle={() => onToggleTable(object)}
							onChange={(definition) => onChange(updateDefinition(draft, object, definition))}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function SensitiveTableRow({
	object,
	depth,
	open,
	definition,
	onToggle,
	onChange,
}: {
	object: DatabaseContextObject;
	depth: number;
	open: boolean;
	definition?: SensitiveTableDefinition;
	onToggle: () => void;
	onChange: (definition?: SensitiveTableDefinition) => void;
}) {
	const selected = new Set(definition?.constraintColumns ?? []);
	const panelId = `row-security-table-${toDomId(rowSecurityTableKey(object))}`;
	return (
		<li>
			<button
				type='button'
				className={cn(
					'flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-muted/50',
					definition && 'bg-primary/10',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
				aria-label={`${open ? 'Collapse' : 'Expand'} ${object.table} table columns`}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
				<FileExplorerIcon name={object.table} type='table' />
				<span className='min-w-0 flex-1 truncate'>{object.table}</span>
				{definition && (
					<span className='text-xs text-primary'>{definition.constraintColumns.length} selected</span>
				)}
			</button>
			{open && (
				<ul id={panelId} className='bg-muted/20 py-1'>
					{(object.columns ?? []).length === 0 ? (
						<li
							className='py-2 pr-2 text-xs text-muted-foreground'
							style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
						>
							No synced columns available.
						</li>
					) : (
						(object.columns ?? []).map((column) => (
							<li key={column}>
								<label
									className='flex h-8 cursor-pointer items-center gap-2 pr-2 text-sm hover:bg-muted/50'
									style={{ paddingLeft: `${getTreeNodePadding(depth + 1) + 22}px` }}
								>
									<Checkbox
										checked={selected.has(column)}
										aria-label={`${column} constraint column for ${object.table}`}
										onCheckedChange={(checked) => {
											const columns = checked
												? [...selected, column]
												: [...selected].filter((selectedColumn) => selectedColumn !== column);
											onChange(
												columns.length > 0
													? {
															databaseType: object.databaseType,
															database: object.database,
															schema: object.schema,
															table: object.table,
															constraintColumns: columns.sort(),
														}
													: undefined,
											);
										}}
									/>
									<span>{column}</span>
								</label>
							</li>
						))
					)}
				</ul>
			)}
		</li>
	);
}

function StatusRow({ status, onRetry }: { status: string; onRetry?: () => void }) {
	return (
		<div className='flex min-h-10 items-center gap-2 p-3 text-sm text-muted-foreground'>
			<span className='min-w-0 flex-1'>{status}</span>
			{onRetry && (
				<Button type='button' size='sm' variant='ghost' className='rounded-full' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function toDomId(value: string): string {
	return value
		.split('')
		.map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
		.join('');
}

export function filterRowSecurityObjects(
	objects: readonly DatabaseContextObject[],
	search: string,
): DatabaseContextObject[] {
	const term = normalizeRowSecuritySearch(search);
	if (!term) {
		return [...objects];
	}
	return objects.filter((object) =>
		[object.database, object.schema, object.table, ...(object.columns ?? [])].some((value) =>
			matchesRowSecuritySearch(value, term),
		),
	);
}

function getRowSecuritySearchExpandedKeys(databases: GroupedDatabase[], search: string): Set<string> {
	const term = normalizeRowSecuritySearch(search);
	if (!term) {
		return new Set();
	}

	if (databases.some((database) => matchesRowSecuritySearch(database.database, term))) {
		return new Set();
	}

	const schemaExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			if (matchesRowSecuritySearch(schema.schema, term)) {
				schemaExpandedKeys.add(database.key);
			}
		}
	}
	if (schemaExpandedKeys.size > 0) {
		return schemaExpandedKeys;
	}

	const tableExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			for (const object of schema.tables) {
				if (matchesRowSecuritySearch(object.table, term)) {
					tableExpandedKeys.add(database.key);
					tableExpandedKeys.add(schema.key);
				}
			}
		}
	}
	if (tableExpandedKeys.size > 0) {
		return tableExpandedKeys;
	}

	const columnExpandedKeys = new Set<string>();
	for (const database of databases) {
		for (const schema of database.schemas) {
			for (const object of schema.tables) {
				if ((object.columns ?? []).some((column) => matchesRowSecuritySearch(column, term))) {
					columnExpandedKeys.add(database.key);
					columnExpandedKeys.add(schema.key);
					columnExpandedKeys.add(rowSecurityTableKey(object));
				}
			}
		}
	}
	return columnExpandedKeys;
}

function normalizeRowSecuritySearch(search: string): string {
	return search.trim().toLowerCase();
}

function matchesRowSecuritySearch(value: string, term: string): boolean {
	return value.toLowerCase().includes(term);
}

function updateDefinition(
	rowSecurity: ProjectRowSecurity,
	object: DatabaseContextObject | SensitiveTableDefinition,
	definition?: SensitiveTableDefinition,
): ProjectRowSecurity {
	const key = rowSecurityTableKey(object);
	return normalizeProjectRowSecurity({
		version: 1,
		tables: [
			...rowSecurity.tables.filter((table) => rowSecurityTableKey(table) !== key),
			...(definition ? [definition] : []),
		],
	});
}
function cloneRowSecurity(rowSecurity: ProjectRowSecurity): ProjectRowSecurity {
	return {
		version: 1,
		tables: rowSecurity.tables.map(cloneSensitiveTableDefinition),
	};
}

function cloneSensitiveTableDefinition(definition: SensitiveTableDefinition): SensitiveTableDefinition {
	return {
		...definition,
		constraintColumns: [...definition.constraintColumns],
	};
}

function getConfiguredTableCount(rowSecurity: ProjectRowSecurity, schema: GroupedSchema): number {
	return rowSecurity.tables.filter(
		(table) =>
			table.databaseType === schema.databaseType &&
			table.database === schema.database &&
			table.schema === schema.schema,
	).length;
}

function getConfiguredDatabaseTableCount(rowSecurity: ProjectRowSecurity, database: GroupedDatabase): number {
	return rowSecurity.tables.filter(
		(table) => table.databaseType === database.databaseType && table.database === database.database,
	).length;
}

function getUnavailableDefinitions(
	rowSecurity: ProjectRowSecurity,
	objects: DatabaseContextObject[],
): SensitiveTableDefinition[] {
	return rowSecurity.tables.flatMap((definition) => {
		const object = objects.find((candidate) => rowSecurityTableKey(candidate) === rowSecurityTableKey(definition));
		if (!object) {
			return [definition];
		}
		const missingColumns = definition.constraintColumns.filter(
			(column) => !(object.columns ?? []).includes(column),
		);
		return missingColumns.length > 0 ? [{ ...definition, constraintColumns: missingColumns }] : [];
	});
}

function removeUnavailableSelection(
	rowSecurity: ProjectRowSecurity,
	unavailable: SensitiveTableDefinition,
): ProjectRowSecurity {
	const key = rowSecurityTableKey(unavailable);
	const table = rowSecurity.tables.find((candidate) => rowSecurityTableKey(candidate) === key);
	if (!table) {
		return rowSecurity;
	}
	const missingColumns = new Set(unavailable.constraintColumns);
	const remainingColumns = table.constraintColumns.filter((column) => !missingColumns.has(column));
	return normalizeProjectRowSecurity({
		version: 1,
		tables: [
			...rowSecurity.tables.filter((candidate) => rowSecurityTableKey(candidate) !== key),
			...(remainingColumns.length > 0 ? [{ ...table, constraintColumns: remainingColumns }] : []),
		],
	});
}
