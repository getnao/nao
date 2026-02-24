import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { UIToolPart } from '@nao/backend/chat';
import { useMemoObject } from '@/hooks/useMemoObject';

type ToolCallContextValue = {
	toolPart: UIToolPart;
	isSettled: boolean;
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
	value: ToolCallContextValue;
	children: ReactNode;
}

export const ToolCallProvider = ({ value, children }: ToolCallProviderProps) => {
	return <ToolCallContext.Provider value={useMemoObject(value)}>{children}</ToolCallContext.Provider>;
};
