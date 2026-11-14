import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import type { ContextExplorerSearch } from '@/lib/context-explorer-search';
import { useCanUseAdvancedContextExplorer } from '@/hooks/use-can-use-advanced-context-explorer';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { requiresFileTree } from '@/lib/context-explorer-search';
import { createLocalStorage } from '@/lib/local-storage';

export type ContextHubView = 'docs' | 'files';

const pickedViewStorage = createLocalStorage<ContextHubView>('nao-context-hub-view-mode', 'files');

/**
 * The view the Context Hub shows on whichever page it is opened: the one last picked, the file tree for links to tests
 * or diffs, and always the doc view for people the file tree is not granted to. A link to a test or a diff picks the
 * file tree, so it stays once the file tree has read the link and dropped it from the URL.
 */
export function useContextHubView(search: ContextExplorerSearch) {
	const navigate = useNavigate();
	const canUseFileTree = useCanUseAdvancedContextExplorer();
	const [pickedView, setPickedView] = useLocalStorage(pickedViewStorage);
	const isFileTreeRequired = canUseFileTree && requiresFileTree(search);

	useEffect(() => {
		if (isFileTreeRequired) {
			setPickedView('files');
		}
	}, [isFileTreeRequired, setPickedView]);

	const switchView = useCallback(
		(view: ContextHubView, openPath: string | null) => {
			setPickedView(view);
			void navigate({ to: '.', search: openPath ? { path: openPath } : {}, replace: true });
		},
		[navigate, setPickedView],
	);

	if (!canUseFileTree) {
		return { view: 'docs' as const, switchView: undefined };
	}
	return { view: isFileTreeRequired ? ('files' as const) : pickedView, switchView };
}
