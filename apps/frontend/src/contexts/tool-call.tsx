import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { UIToolPart } from '@nao/backend/chat';

type ToolCallContextValue = {
	toolPart: UIToolPart;
};

export const ToolCallContext = createContext<ToolCallContextValue | null>(null);

export const useToolCallContext = () => {
	const context = useContext(ToolCallContext);
	if (!context) {
		throw new Error('useToolCallContext must be used within ToolCallProvider');
	}
	return context;
};

export interface ToolCallProps {
	toolPart: UIToolPart;
}

interface ToolCallProviderProps {
	toolPart: UIToolPart;
	children: ReactNode;
}

export const ToolCallProvider = ({ toolPart, children }: ToolCallProviderProps) => {
	return <ToolCallContext.Provider value={{ toolPart }}>{children}</ToolCallContext.Provider>;
};
