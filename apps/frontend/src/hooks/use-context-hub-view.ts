import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import type { CreatedSkill } from '@/components/personal-skills';
import type { ContextExplorerSearch } from '@/lib/context-explorer-search';
import { contextHubChatPanelOpenStorage } from '@/components/context-hub/context-hub-chat-panel';
import { useCanUseAdvancedContextExplorer } from '@/hooks/use-can-use-advanced-context-explorer';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { requiresFileTree } from '@/lib/context-explorer-search';
import { createLocalStorage } from '@/lib/local-storage';

export type ContextHubView = 'docs' | 'files';

const pickedViewStorage = createLocalStorage<ContextHubView>('nao-context-hub-view-mode', 'files');

/**
 * The view the Context Hub shows on whichever page it is opened: the one last picked, the file tree for links to past
 * diffs, and always the doc view for people the file tree is not granted to. A link to a diff picks the file tree, so
 * it stays once the file tree has read the link and dropped it from the URL.
 */
export function useContextHubView(search: ContextExplorerSearch) {
	const navigate = useNavigate();
	const canUseFileTree = useCanUseAdvancedContextExplorer();
	const [pickedView, setPickedView] = useLocalStorage(pickedViewStorage);
	const isFileTreeRequired = canUseFileTree && requiresFileTree(search);
	const isDocViewRequired = search.skills === 'open' || search.skill !== undefined;

	useEffect(() => {
		if (isFileTreeRequired) {
			setPickedView('files');
		} else if (isDocViewRequired) {
			setPickedView('docs');
		}
	}, [isFileTreeRequired, isDocViewRequired, setPickedView]);

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
	const view: ContextHubView = isFileTreeRequired ? 'files' : isDocViewRequired ? 'docs' : pickedView;
	return { view, switchView };
}

/** Opens a skill in the doc view of the Context Hub, the one with nao's chat beside it, which it opens too. */
export function useOpenSkillInContextHub() {
	const navigate = useNavigate();

	return useCallback(
		(skill: CreatedSkill) => {
			pickedViewStorage.set('docs');
			contextHubChatPanelOpenStorage.set(true);
			void navigate({
				to: '/context-hub',
				search: skill.scope === 'personal' ? { skill: skill.name } : { path: skill.path },
			});
		},
		[navigate],
	);
}
