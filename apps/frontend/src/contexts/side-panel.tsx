import { createContext, useContext } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface SidePanelContext {
	content: React.ReactNode;
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

export const SidePanelProvider = ({ children, value }: { children: React.ReactNode; value: SidePanelContext }) => {
	return <SidePanelContext.Provider value={useMemoObject(value)}>{children}</SidePanelContext.Provider>;
};
