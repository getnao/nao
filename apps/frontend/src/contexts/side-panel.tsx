import { createContext, useContext, useMemo } from 'react';

interface SidePanelContext {
	isVisible: boolean;
	currentStoryId: string | null;
	chatId: string | null;
	isReadonlyMode: boolean;
	open: (content: React.ReactNode, storyId?: string) => void;
	close: () => void;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);

const noopSidePanel: SidePanelContext = {
	isVisible: false,
	currentStoryId: null,
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
	currentStoryId,
	chatId,
	isReadonlyMode = false,
	open,
	close,
}: {
	children: React.ReactNode;
	isVisible: boolean;
	currentStoryId: string | null;
	chatId: string | null;
	isReadonlyMode?: boolean;
	open: (content: React.ReactNode, storyId?: string) => void;
	close: () => void;
}) => {
	const value = useMemo(
		() => ({ isVisible, currentStoryId, chatId, isReadonlyMode, open, close }),
		[isVisible, currentStoryId, chatId, isReadonlyMode, open, close],
	);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
