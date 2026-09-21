import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

export interface BeforeAgentSendResult {
	canSend: boolean;
	afterSend?: () => void;
}

type BeforeAgentSendGuard = () => Promise<BeforeAgentSendResult>;

export async function runWithStoryBeforeAgentSend({
	beforeSend,
	send,
}: {
	beforeSend: BeforeAgentSendGuard;
	send: () => Promise<void>;
}): Promise<boolean> {
	const result = await beforeSend();
	if (!result.canSend) {
		return false;
	}

	const sendPromise = send();
	result.afterSend?.();
	await sendPromise;
	return true;
}

interface RegisteredGuard {
	chatId: string;
	guard: BeforeAgentSendGuard;
}

interface StoryBeforeAgentSendContextValue {
	run: (chatId: string) => Promise<BeforeAgentSendResult>;
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
			return { canSend: true };
		}
		return registration.guard();
	}, []);

	const value = useMemo(() => ({ run, register }), [register, run]);

	return <StoryBeforeAgentSendContext.Provider value={value}>{children}</StoryBeforeAgentSendContext.Provider>;
}

export function useStoryBeforeAgentSend(): Pick<StoryBeforeAgentSendContextValue, 'run'> {
	const context = useContext(StoryBeforeAgentSendContext);
	if (!context) {
		return { run: async () => ({ canSend: true }) };
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
