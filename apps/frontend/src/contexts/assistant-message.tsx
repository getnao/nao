import { createContext, useContext } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface AssistantMessageContextValue {
	isSettled: boolean;
}

const AssistantMessageContext = createContext<AssistantMessageContextValue | null>(null);

export const useAssistantMessage = () => {
	const context = useContext(AssistantMessageContext);
	if (!context) {
		throw new Error('useAssistantMessage must be used within a AssistantMessageProvider');
	}
	return context;
};

export const AssistantMessageProvider = ({
	children,
	isSettled,
}: {
	children: React.ReactNode;
	isSettled: boolean;
}) => {
	return (
		<AssistantMessageContext.Provider value={useMemoObject({ isSettled })}>
			{children}
		</AssistantMessageContext.Provider>
	);
};
