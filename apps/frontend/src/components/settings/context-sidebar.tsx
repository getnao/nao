import type { ReactNode } from 'react';

import { EditorTab, TabBar } from '@/components/settings/sortable-tabs';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';

type ContextSidebarView = 'files' | 'changes';

const sidebarViewStorage = createLocalStorage<ContextSidebarView>('nao-context-sidebar-view', 'files');

/** The left column of the File Explorer, showing the files or the changes, remembered in this browser. */
export function ContextSidebar({
	changeCount,
	files,
	changes,
}: {
	changeCount: number;
	files: ReactNode;
	changes: ReactNode;
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
			<div className='min-h-0 flex-1'>{view === 'files' ? files : changes}</div>
		</div>
	);
}
