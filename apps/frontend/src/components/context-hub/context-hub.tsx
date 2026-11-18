import type { ContextExplorerSearch } from '@/lib/context-explorer-search';
import { ContextDocView } from '@/components/context-hub/context-doc-view';
import { ContextFileTreeView } from '@/components/context-hub/context-file-tree-view';
import { useContextHubView } from '@/hooks/use-context-hub-view';

/** The Context Hub in the view picked, on the page it was opened from: the app or the settings. */
export function ContextHub({ search }: { search: ContextExplorerSearch }) {
	const { view, switchView } = useContextHubView(search);

	if (view === 'files') {
		return <ContextFileTreeView search={search} onSwitchView={switchView} />;
	}
	return <ContextDocView requestedPath={search.path ?? null} onSwitchView={switchView} />;
}
