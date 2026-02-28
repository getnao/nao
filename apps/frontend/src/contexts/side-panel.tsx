import { createContext, useContext, useMemo } from 'react';

interface SidePanelContext {
	isVisible: boolean;
	currentStoryId: string | null;
	open: (content: React.ReactNode, storyId?: string) => void;
	close: () => void;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);

const noopSidePanel: SidePanelContext = {
	isVisible: false,
	currentStoryId: null,
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
	open,
	close,
}: {
	children: React.ReactNode;
	isVisible: boolean;
	currentStoryId: string | null;
	open: (content: React.ReactNode, storyId?: string) => void;
	close: () => void;
}) => {
	const value = useMemo(() => ({ isVisible, currentStoryId, open, close }), [isVisible, currentStoryId, open, close]);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
