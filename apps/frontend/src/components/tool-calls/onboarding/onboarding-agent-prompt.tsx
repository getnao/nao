import type { ToolCallComponentProps } from '..';
import { AgentPromptCard } from '@/components/agent-prompt-card';

export function OnboardingAgentPromptToolCall({ toolPart }: ToolCallComponentProps<'onboarding_agent_prompt'>) {
	const prompt = toolPart.input?.prompt;

	if (!prompt) {
		return null;
	}

	return (
		<div className='-mx-3'>
			<AgentPromptCard prompt={prompt} />
		</div>
	);
}
