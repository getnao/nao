import { Table2 } from 'lucide-react';

import type { ContextHubDoc, ContextHubTable } from '@/lib/context-hub';
import { ContextFileRecommendations } from '@/components/context-hub/context-file-recommendations';
import { ContextHubFile } from '@/components/context-hub/context-hub-file';
import { ContextFileDiff } from '@/components/settings/context-file-diff';
import { EditorTab, TabBar } from '@/components/settings/sortable-tabs';
import { formatTableLocation } from '@/lib/context-hub';

interface ContextHubViewerProps {
	/** The table the open file belongs to, whose pages are offered as tabs. */
	table: ContextHubTable | null;
	doc: ContextHubDoc | null;
	path: string | null;
	/** A change picked in the Changes tab, shown instead of the open file. */
	diffPath: string | null;
	isDirty: boolean;
	onOpenFile: (path: string) => void;
	onDirtyChange: (isDirty: boolean) => void;
}

/** The right column of the doc view once something is open: a doc, the page of a table, or a change. */
export function ContextHubViewer({
	table,
	doc,
	path,
	diffPath,
	isDirty,
	onOpenFile,
	onDirtyChange,
}: ContextHubViewerProps) {
	if (diffPath) {
		return <ContextFileDiff path={diffPath} />;
	}
	if (!path) {
		return null;
	}

	return (
		<div className='flex h-full flex-col'>
			{table ? (
				<TableTabs table={table} selectedPath={path} isDirty={isDirty} onOpenFile={onOpenFile} />
			) : (
				doc && (
					<TabBar label='Opened doc'>
						<EditorTab
							label={doc.title}
							isActive
							isUnsaved={isDirty}
							onSelect={() => onOpenFile(doc.path)}
						/>
					</TabBar>
				)
			)}
			<ContextFileRecommendations path={path} isDirty={isDirty} />
			<div className='min-h-0 flex-1'>
				<ContextHubFile path={path} onDirtyChange={onDirtyChange} onOpenFile={onOpenFile} />
			</div>
		</div>
	);
}

function TableTabs({
	table,
	selectedPath,
	isDirty,
	onOpenFile,
}: {
	table: ContextHubTable;
	selectedPath: string;
	isDirty: boolean;
	onOpenFile: (path: string) => void;
}) {
	const location = formatTableLocation(table);

	return (
		<TabBar
			label='Table pages'
			leading={
				<div
					className='flex min-w-0 shrink items-center gap-1.5 border-r pr-2.5 pl-1.5 text-[13px]'
					title={location ? `${table.table} · ${location}` : table.table}
				>
					<Table2 className='size-4 shrink-0 text-muted-foreground' />
					<span className='truncate font-medium'>{table.table}</span>
				</div>
			}
		>
			{table.files.map((file) => (
				<EditorTab
					key={file.path}
					label={file.label}
					isActive={file.path === selectedPath}
					isUnsaved={isDirty && file.path === selectedPath}
					onSelect={() => onOpenFile(file.path)}
				/>
			))}
		</TabBar>
	);
}
