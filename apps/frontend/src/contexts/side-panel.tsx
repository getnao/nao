import { createContext, useContext } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface SidePanelContext {
	content: React.ReactNode;
	open: (content: React.ReactNode) => void;
}

const SidePanelContext = createContext<{
	content: React.ReactNode;
	open: (content: React.ReactNode) => void;
} | null>(null);

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
