import { createContext, useContext, useMemo } from 'react';

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
			open,
			close,
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
			open,
			close,
		],
	);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
