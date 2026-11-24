import type { ContextExplorerSearch } from '@/lib/context-explorer-search';
import { ContextDocView } from '@/components/context-hub/context-doc-view';
import { ContextFileTreeView } from '@/components/context-hub/context-file-tree-view';
import { ContextHubSkillsView } from '@/components/context-hub/context-hub-skill-page';
import { useContextHubView } from '@/hooks/use-context-hub-view';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * The Context Hub in the view picked, on the page it was opened from: the app or the settings. Members reach it only
 * through personal skills, so they get the skills alone.
 */
export function ContextHub({ search }: { search: ContextExplorerSearch }) {
	const { canExploreContext } = usePermissions();

	if (!canExploreContext) {
		return <ContextHubSkillsView />;
	}
	return <ContextEditorHub search={search} />;
}

function ContextEditorHub({ search }: { search: ContextExplorerSearch }) {
	const { view, switchView } = useContextHubView(search);

	if (view === 'files') {
		return <ContextFileTreeView search={search} onSwitchView={switchView} />;
	}
	return <ContextDocView search={search} onSwitchView={switchView} />;
}
