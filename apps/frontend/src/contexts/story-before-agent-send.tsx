import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

type BeforeAgentSendGuard = () => Promise<boolean>;

interface RegisteredGuard {
	chatId: string;
	guard: BeforeAgentSendGuard;
}

interface StoryBeforeAgentSendContextValue {
	run: (chatId: string) => Promise<boolean>;
	register: (registration: RegisteredGuard) => () => void;
}

const StoryBeforeAgentSendContext = createContext<StoryBeforeAgentSendContextValue | null>(null);

export function StoryBeforeAgentSendProvider({ children }: { children: React.ReactNode }) {
	const guardRef = useRef<RegisteredGuard | null>(null);

	const register = useCallback((registration: RegisteredGuard) => {
		guardRef.current = registration;
		return () => {
			if (guardRef.current === registration) {
				guardRef.current = null;
			}
		};
	}, []);

	const run = useCallback(async (chatId: string) => {
		const registration = guardRef.current;
		if (!registration || registration.chatId !== chatId) {
			return true;
		}
		return registration.guard();
	}, []);

	const value = useMemo(() => ({ run, register }), [register, run]);

	return <StoryBeforeAgentSendContext.Provider value={value}>{children}</StoryBeforeAgentSendContext.Provider>;
}

export function useStoryBeforeAgentSend() {
	const context = useContext(StoryBeforeAgentSendContext);
	if (!context) {
		return { run: async () => true };
	}
	return context;
}

export function useRegisterStoryBeforeAgentSend({
	chatId,
	enabled,
	guard,
}: {
	chatId: string;
	enabled: boolean;
	guard: BeforeAgentSendGuard;
}) {
	const context = useContext(StoryBeforeAgentSendContext);
	const guardRef = useRef(guard);
	guardRef.current = guard;

	useEffect(() => {
		if (!context || !enabled) {
			return;
		}
		return context.register({
			chatId,
			guard: () => guardRef.current(),
		});
	}, [chatId, context, enabled]);
}
