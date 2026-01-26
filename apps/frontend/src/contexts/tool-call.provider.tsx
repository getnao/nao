import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { UIToolPart } from 'backend/chat';

interface ToolCallContextValue {
	toolPart: UIToolPart;
	isHovering: boolean;
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
}

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
	const [isExpanded, setIsExpanded] = useState(false);
	const [isHovering, setIsHovering] = useState(false);

	return (
		<ToolCallContext.Provider value={{ toolPart, isHovering, isExpanded, setIsExpanded }}>
			<div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}>
				{children}
			</div>
		</ToolCallContext.Provider>
	);
};
