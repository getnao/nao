import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { ShareSource } from '@nao/shared/types';

interface SidePanelState {
	isVisible: boolean;
	currentStorySlug: string | null;
	currentStoryTabIndex: number;
}

interface SidePanelActions {
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
	setCurrentStorySlug: (slug: string | null) => void;
	setCurrentStoryTabIndex: (index: number) => void;
	registerBeforeChange: (guard: (continueChange: () => void) => void) => () => void;
	getState: () => SidePanelState;
}

interface SidePanelContext extends SidePanelState, SidePanelActions {
	chatId: string | null;
	shareSource: ShareSource | null;
	isReadonlyMode: boolean;
	isReplay: boolean;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);
const SidePanelActionsContext = createContext<SidePanelActions | null>(null);

const closedSidePanelState: SidePanelState = { isVisible: false, currentStorySlug: null, currentStoryTabIndex: 0 };

const noopSidePanel: SidePanelContext = {
	...closedSidePanelState,
	setCurrentStorySlug: () => {},
	setCurrentStoryTabIndex: () => {},
	chatId: null,
	shareSource: null,
	isReadonlyMode: false,
	isReplay: false,
	open: () => {},
	close: () => {},
	registerBeforeChange: () => () => {},
	getState: () => closedSidePanelState,
};

export const useSidePanel = () => {
	return useContext(SidePanelContext) ?? noopSidePanel;
};

/** Stable across panel state changes, for components that only act on the panel or read its state in handlers. */
export const useSidePanelActions = (): SidePanelActions => {
	return useContext(SidePanelActionsContext) ?? noopSidePanel;
};

export const SidePanelProvider = ({
	children,
	isVisible,
	currentStorySlug,
	setCurrentStorySlug,
	currentStoryTabIndex,
	setCurrentStoryTabIndex,
	chatId,
	shareSource = null,
	isReadonlyMode = false,
	isReplay = false,
	open,
	close,
}: {
	children: React.ReactNode;
	isVisible: boolean;
	currentStorySlug: string | null;
	setCurrentStorySlug: (slug: string | null) => void;
	currentStoryTabIndex: number;
	setCurrentStoryTabIndex: (index: number) => void;
	chatId: string | null;
	shareSource?: ShareSource | null;
	isReadonlyMode?: boolean;
	isReplay?: boolean;
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
}) => {
	const latestRef = useRef({ isVisible, currentStorySlug, currentStoryTabIndex, open, close });
	useLayoutEffect(() => {
		latestRef.current = { isVisible, currentStorySlug, currentStoryTabIndex, open, close };
	});
	const beforeChangeRef = useRef<((continueChange: () => void) => void) | null>(null);
	const registerBeforeChange = useCallback((guard: (continueChange: () => void) => void) => {
		beforeChangeRef.current = guard;
		return () => {
			if (beforeChangeRef.current === guard) {
				beforeChangeRef.current = null;
			}
		};
	}, []);
	const actions = useMemo<SidePanelActions>(() => {
		const runGuarded = (change: () => void) => {
			const { isVisible: isOpen, currentStorySlug: openStorySlug } = latestRef.current;
			if (isOpen && openStorySlug && beforeChangeRef.current) {
				beforeChangeRef.current(change);
				return;
			}
			change();
		};
		return {
			open: (content, storySlug) => runGuarded(() => latestRef.current.open(content, storySlug)),
			close: () => runGuarded(() => latestRef.current.close()),
			setCurrentStorySlug,
			setCurrentStoryTabIndex,
			registerBeforeChange,
			getState: () => latestRef.current,
		};
	}, [setCurrentStorySlug, setCurrentStoryTabIndex, registerBeforeChange]);
	const value = useMemo(
		() => ({
			...actions,
			isVisible,
			currentStorySlug,
			currentStoryTabIndex,
			chatId,
			shareSource,
			isReadonlyMode,
			isReplay,
		}),
		[actions, isVisible, currentStorySlug, currentStoryTabIndex, chatId, shareSource, isReadonlyMode, isReplay],
	);
	return (
		<SidePanelActionsContext.Provider value={actions}>
			<SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>
		</SidePanelActionsContext.Provider>
	);
};
