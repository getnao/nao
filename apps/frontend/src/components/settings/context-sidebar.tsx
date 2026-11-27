import type { ReactNode } from 'react';

import { EditorTab, TabBar } from '@/components/settings/sortable-tabs';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';

type ContextSidebarView = 'files' | 'changes' | 'sync';

const sidebarViewStorage = createLocalStorage<ContextSidebarView>('nao-context-sidebar-view', 'files');

/**
 * The left column of the File Explorer, showing the files or the changes, remembered in this browser. Both stay
 * mounted, so a commit message or file selection survives a look at the files.
 */
export function ContextSidebar({
	filesLabel = 'Files',
	onSelectFiles,
	changeCount,
	files,
	changes,
	sync,
	viewMenu,
	footer,
}: {
	filesLabel?: string;
	/** Runs on every click of the files tab, even when it is already shown, like going back to a home page. */
	onSelectFiles?: () => void;
	changeCount: number;
	files: ReactNode;
	changes?: ReactNode;
	sync?: ReactNode;
	/** Sits at the end of the tab bar, like the menu switching to the doc view. */
	viewMenu?: ReactNode;
	/** Stays under both views, like a warning panel. */
	footer?: ReactNode;
}) {
	const [view, setView] = useLocalStorage(sidebarViewStorage);
	const activeView =
		(view === 'changes' && changes === undefined) || (view === 'sync' && sync === undefined) ? 'files' : view;

	return (
		<div className='flex h-full flex-col overflow-hidden bg-card'>
			<TabBar label='Context Hub views' trailing={viewMenu}>
				<div className='flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
					<EditorTab
						label={filesLabel}
						isActive={activeView === 'files'}
						onSelect={() => {
							setView('files');
							onSelectFiles?.();
						}}
					/>
					{changes !== undefined && (
						<EditorTab
							label='Changes'
							badge={changeCount > 0 ? changeCount : undefined}
							isActive={activeView === 'changes'}
							onSelect={() => setView('changes')}
						/>
					)}
					{sync !== undefined && (
						<EditorTab label='Sync' isActive={activeView === 'sync'} onSelect={() => setView('sync')} />
					)}
				</div>
			</TabBar>
			<div className={cn('min-h-0 flex-1', activeView !== 'files' && 'hidden')}>{files}</div>
			{changes !== undefined && (
				<div className={cn('min-h-0 flex-1', activeView !== 'changes' && 'hidden')}>{changes}</div>
			)}
			{sync !== undefined && (
				<div className={cn('min-h-0 flex-1 overflow-auto', activeView !== 'sync' && 'hidden')}>{sync}</div>
			)}
			{footer}
		</div>
	);
}
