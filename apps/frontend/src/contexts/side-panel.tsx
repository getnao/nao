import { createContext, useContext, useMemo } from 'react';

interface SidePanelContext {
	isVisible: boolean;
	currentStorySlug: string | null;
	chatId: string | null;
	isReadonlyMode: boolean;
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);

const noopSidePanel: SidePanelContext = {
	isVisible: false,
	currentStorySlug: null,
	chatId: null,
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
	chatId,
	isReadonlyMode = false,
	open,
	close,
}: {
	children: React.ReactNode;
	isVisible: boolean;
	currentStorySlug: string | null;
	chatId: string | null;
	isReadonlyMode?: boolean;
	open: (content: React.ReactNode, storySlug?: string) => void;
	close: () => void;
}) => {
	const value = useMemo(
		() => ({ isVisible, currentStorySlug, chatId, isReadonlyMode, open, close }),
		[isVisible, currentStorySlug, chatId, isReadonlyMode, open, close],
	);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
