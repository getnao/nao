import { createContext, useContext, useMemo } from 'react';

interface SidePanelContext {
	isVisible: boolean;
	currentStoryId: string | null;
	open: (content: React.ReactNode, storyId?: string) => void;
}

const SidePanelContext = createContext<SidePanelContext | null>(null);

export const useSidePanel = () => {
	const context = useContext(SidePanelContext);
	if (!context) {
		throw new Error('useSidePanel must be used within a SidePanelProvider');
	}
	return context;
};

export const SidePanelProvider = ({
	children,
	isVisible,
	currentStoryId,
	open,
}: {
	children: React.ReactNode;
	isVisible: boolean;
	currentStoryId: string | null;
	open: (content: React.ReactNode, storyId?: string) => void;
}) => {
	const value = useMemo(() => ({ isVisible, currentStoryId, open }), [isVisible, currentStoryId, open]);
	return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};
