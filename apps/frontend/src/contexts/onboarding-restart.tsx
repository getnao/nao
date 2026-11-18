import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createContext, useCallback, useContext } from 'react';

import { useAgentContext } from '@/contexts/agent.provider';
import { getOnboardingChatIdStorage } from '@/hooks/use-agent';
import { NEW_CHAT_ID } from '@/lib/ai';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

const StartNewOnboardingContext = createContext<(() => void) | null>(null);

export const StartNewOnboardingProvider = StartNewOnboardingContext.Provider;

/** Cancels the warehouse setup in progress, then moves the user to a fresh onboarding conversation. */
export function useRestartOnboarding() {
	const { chatId } = useAgentContext();
	const startNewOnboarding = useStartNewOnboarding();
	const {
		mutateAsync: cancelSetup,
		isPending,
		error,
	} = useMutation(trpc.onboarding.restartOnboarding.mutationOptions());

	const restart = useCallback(async () => {
		if (chatId && chatId !== NEW_CHAT_ID) {
			await cancelSetup({ onboardingChatId: chatId });
		}
		await startNewOnboarding();
	}, [cancelSetup, chatId, startNewOnboarding]);

	return { restart, isPending, error };
}

/** Leaves the current onboarding conversation, in place on the onboarding page or by navigating to it. */
export function useStartNewOnboarding() {
	const startInPlace = useContext(StartNewOnboardingContext);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user.id;

	return useCallback(async () => {
		if (userId) {
			getOnboardingChatIdStorage(userId).set(null);
		}
		await queryClient.invalidateQueries({ queryKey: trpc.onboarding.pathKey() });
		queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] }).catch(console.error);
		if (startInPlace) {
			startInPlace();
			return;
		}
		await navigate({ to: '/onboarding' });
	}, [navigate, queryClient, startInPlace, userId]);
}
