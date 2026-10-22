// @vitest-environment jsdom

/**
 * A clarification call cut off mid-arguments is repaired with its fields left unchecked, so
 * `options` and `question` can reach the renderer with the wrong type.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClarificationToolCall } from './clarification';
import type { ToolCallComponentProps } from '.';
import { ToolCallProvider } from '@/contexts/tool-call';

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({ queueOrSendMessage: vi.fn(), isRunning: false }),
	useAgentMessagesSelector: () => null,
}));

type ClarificationPart = ToolCallComponentProps<'clarification'>['toolPart'];

const clarificationPart = (input: unknown) =>
	({
		type: 'tool-clarification',
		toolCallId: 'call-1',
		state: 'output-available',
		input,
	}) as unknown as ClarificationPart;

const renderClarification = (input: unknown) => {
	const toolPart = clarificationPart(input);
	return render(
		<ToolCallProvider value={{ toolPart, isSettled: true }}>
			<ClarificationToolCall toolPart={toolPart} />
		</ToolCallProvider>,
	);
};

afterEach(cleanup);

describe('ClarificationToolCall', () => {
	it('keeps the question and drops the choices when options is not an array', () => {
		renderClarification({ question: 'Which database are you using?', options: 'DuckDB' });

		expect(screen.getByText('Which database are you using?')).toBeDefined();
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.getByText('Type your answer below.')).toBeDefined();
	});

	it('renders one choice per option when options is an array', () => {
		renderClarification({ question: 'Which database are you using?', options: ['DuckDB', ' Snowflake '] });

		expect(screen.getByRole('button', { name: 'DuckDB' })).toBeDefined();
		expect(screen.getByRole('button', { name: 'Snowflake' })).toBeDefined();
	});

	it('renders nothing when question is not a string', () => {
		expect(() => renderClarification({ question: { text: 'Which one?' }, options: ['DuckDB'] })).not.toThrow();
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('drops option entries that are not usable strings', () => {
		renderClarification({ question: 'Which database are you using?', options: ['DuckDB', 42, '   ', null] });

		expect(screen.getAllByRole('button')).toHaveLength(1);
	});
});
