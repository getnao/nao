import { createContext, useContext } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface AssistantMessageContextValue {
	isSettled: boolean;
	isReplay: boolean;
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
	isReplay = false,
}: {
	children: React.ReactNode;
	isSettled: boolean;
	isReplay?: boolean;
}) => {
	return (
		<AssistantMessageContext.Provider value={useMemoObject({ isSettled, isReplay })}>
			{children}
		</AssistantMessageContext.Provider>
	);
};
