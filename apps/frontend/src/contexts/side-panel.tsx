import { createContext, useCallback, useContext, useMemo, useRef } from 'react';

type ShareType = 'chat' | 'story';

interface SidePanelContext {
	isVisible: boolean;
	currentStorySlug: string | null;
	setCurrentStorySlug: (slug: string | null) => void;
	currentStoryTabIndex: number;
	setCurrentStoryTabIndex: (index: number) => void;
	chatId: string | null;
	shareId: string | null;
	shareType: ShareType | null;
	isReadonlyMode: boolean;
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
	registerBeforeChange: (guard: (continueChange: () => void) => void) => () => void;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);

const noopSidePanel: SidePanelContext = {
	isVisible: false,
	currentStorySlug: null,
	setCurrentStorySlug: () => {},
	currentStoryTabIndex: 0,
	setCurrentStoryTabIndex: () => {},
	chatId: null,
	shareId: null,
	shareType: null,
	isReadonlyMode: false,
	open: () => {},
	close: () => {},
	registerBeforeChange: () => () => {},
};

export const useSidePanel = () => {
	return useContext(SidePanelContext) ?? noopSidePanel;
};

export const SidePanelProvider = ({
	children,
	isVisible,
	currentStorySlug,
	setCurrentStorySlug,
	currentStoryTabIndex,
	setCurrentStoryTabIndex,
	chatId,
	shareId = null,
	shareType = null,
	isReadonlyMode = false,
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
	shareId?: string | null;
	shareType?: ShareType | null;
	isReadonlyMode?: boolean;
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
}) => {
	const beforeChangeRef = useRef<((continueChange: () => void) => void) | null>(null);
	const registerBeforeChange = useCallback((guard: (continueChange: () => void) => void) => {
		beforeChangeRef.current = guard;
		return () => {
			if (beforeChangeRef.current === guard) {
				beforeChangeRef.current = null;
			}
		};
	}, []);
	const guardedOpen = useCallback(
		(content: React.ReactNode, storySlug?: string) => {
			if (isVisible && currentStorySlug && beforeChangeRef.current) {
				beforeChangeRef.current(() => open(content, storySlug));
				return;
			}
			open(content, storySlug);
		},
		[currentStorySlug, isVisible, open],
	);
	const guardedClose = useCallback(() => {
		if (isVisible && currentStorySlug && beforeChangeRef.current) {
			beforeChangeRef.current(close);
			return;
		}
		close();
	}, [close, currentStorySlug, isVisible]);
	const value = useMemo(
		() => ({
			isVisible,
			currentStorySlug,
			setCurrentStorySlug,
			currentStoryTabIndex,
			setCurrentStoryTabIndex,
			chatId,
			shareId,
			shareType,
			isReadonlyMode,
			open: guardedOpen,
			close: guardedClose,
			registerBeforeChange,
		}),
		[
			isVisible,
			currentStorySlug,
			setCurrentStorySlug,
			currentStoryTabIndex,
			setCurrentStoryTabIndex,
			chatId,
			shareId,
			shareType,
			isReadonlyMode,
			guardedOpen,
			guardedClose,
			registerBeforeChange,
		],
	);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
