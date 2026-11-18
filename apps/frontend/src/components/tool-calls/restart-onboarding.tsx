import { useEffect, useRef } from 'react';
import { OnboardingStatusLine } from './onboarding-status-line';
import type { ToolCallComponentProps } from '.';

import { useAgentContext } from '@/contexts/agent.provider';
import { useStartNewOnboarding } from '@/contexts/onboarding-restart';

export function RestartOnboardingToolCall({ toolPart }: ToolCallComponentProps<'restart_onboarding'>) {
	const { isRunning } = useAgentContext();
	const startNewOnboarding = useStartNewOnboarding();
	const hasRestarted = toolPart.state === 'output-available';
	const restartedLiveRef = useRef(!hasRestarted);

	useEffect(() => {
		if (!restartedLiveRef.current || !hasRestarted || isRunning) {
			return;
		}
		restartedLiveRef.current = false;
		startNewOnboarding().catch(console.error);
	}, [hasRestarted, isRunning, startNewOnboarding]);

	if (toolPart.errorText) {
		return (
			<OnboardingStatusLine tone='error' label='Could not restart the onboarding' detail={toolPart.errorText} />
		);
	}
	return hasRestarted ? (
		<OnboardingStatusLine tone='restarted' label='Onboarding restarted in a new conversation' />
	) : (
		<OnboardingStatusLine tone='running' label='Restarting the onboarding' />
	);
}
