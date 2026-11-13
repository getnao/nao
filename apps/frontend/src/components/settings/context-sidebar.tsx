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
	changeCount,
	files,
	changes,
	footer,
}: {
	changeCount: number;
	files: ReactNode;
	changes: ReactNode;
	/** Stays under both views, like a warning panel. */
	footer?: ReactNode;
}) {
	const [view, setView] = useLocalStorage(sidebarViewStorage);

	return (
		<div className='flex h-full flex-col overflow-hidden bg-card'>
			<TabBar label='File Explorer views'>
				<EditorTab label='Files' isActive={view === 'files'} onSelect={() => setView('files')} />
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
