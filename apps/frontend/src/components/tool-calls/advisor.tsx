import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

type AdvisorOutcome =
	| { type: 'advice'; text: string }
	| { type: 'redacted' }
	| { type: 'error'; errorCode: string }
	| { type: 'pending' };

export const AdvisorToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const outcome = parseOutcome(toolPart.output, toolPart.errorText);

	return (
		<ToolCallWrapper title={getTitle(outcome, isSettled)} overrideError>
			<div className='p-2 text-sm text-foreground/80 whitespace-pre-wrap wrap-break-word'>
				{getDetails(outcome)}
			</div>
		</ToolCallWrapper>
	);
};

function parseOutcome(output: unknown, errorText: string | undefined): AdvisorOutcome {
	if (errorText) {
		return { type: 'error', errorCode: parseErrorCode(errorText) };
	}
	if (typeof output !== 'object' || output === null) {
		return { type: 'pending' };
	}
	const result = output as Record<string, unknown>;
	if (result.type === 'advisor_result' && typeof result.text === 'string') {
		return { type: 'advice', text: result.text };
	}
	if (result.type === 'advisor_redacted_result') {
		return { type: 'redacted' };
	}
	return { type: 'pending' };
}

function parseErrorCode(errorText: string): string {
	try {
		const error = JSON.parse(errorText) as { errorCode?: unknown };
		return typeof error.errorCode === 'string' ? error.errorCode : errorText;
	} catch {
		return errorText;
	}
}

function getTitle(outcome: AdvisorOutcome, isSettled: boolean): string {
	if (outcome.type === 'error') {
		return 'Advisor unavailable';
	}
	return isSettled ? 'Consulted the advisor' : 'Consulting the advisor';
}

function getDetails(outcome: AdvisorOutcome): string {
	switch (outcome.type) {
		case 'advice':
			return outcome.text;
		case 'redacted':
			return 'The advisor reviewed the conversation and guided the next steps. Anthropic encrypts the advice of this advisor model, so only the agent can read it.';
		case 'error':
			return `The agent continued without advice (${outcome.errorCode.replaceAll('_', ' ')}).`;
		case 'pending':
			return 'The advisor is reviewing the conversation.';
	}
}
