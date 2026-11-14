import type { ReactNode } from 'react';

import { EditorTab, TabBar } from '@/components/settings/sortable-tabs';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';

type ContextSidebarView = 'files' | 'changes';

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
	viewMenu,
	footer,
}: {
	filesLabel?: string;
	/** Runs on every click of the files tab, even when it is already shown, like going back to a home page. */
	onSelectFiles?: () => void;
	changeCount: number;
	files: ReactNode;
	changes: ReactNode;
	/** Sits at the end of the tab bar, like the menu switching to the doc view. */
	viewMenu?: ReactNode;
	/** Stays under both views, like a warning panel. */
	footer?: ReactNode;
}) {
	const [view, setView] = useLocalStorage(sidebarViewStorage);

	return (
		<div className='flex h-full flex-col overflow-hidden bg-card'>
			<TabBar label='Context Hub views' trailing={viewMenu}>
				<EditorTab
					label={filesLabel}
					isActive={view === 'files'}
					onSelect={() => {
						setView('files');
						onSelectFiles?.();
					}}
				/>
				<EditorTab
					label='Changes'
					badge={changeCount > 0 ? changeCount : undefined}
					isActive={view === 'changes'}
					onSelect={() => setView('changes')}
				/>
			</TabBar>
			<div className={cn('min-h-0 flex-1', view !== 'files' && 'hidden')}>{files}</div>
			<div className={cn('min-h-0 flex-1', view !== 'changes' && 'hidden')}>{changes}</div>
			{footer}
		</div>
	);
}
