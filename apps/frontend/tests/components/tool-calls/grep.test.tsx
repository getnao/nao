// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { grep } from '@nao/shared/tools';
import type { ToolCallComponentProps } from '@/components/tool-calls';
import type { ReactNode } from 'react';
import { GrepToolCall } from '@/components/tool-calls/grep';

vi.mock('@/contexts/tool-call', () => ({
	useToolCallContext: () => ({ isSettled: true }),
}));

vi.mock('@/components/tool-calls/tool-call-wrapper', () => ({
	ToolCallWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

describe('GrepToolCall', () => {
	it('renders source line numbers carried by context rows', () => {
		renderGrepMatch({
			path: '/RULES.md',
			line_number: 8,
			line_content: 'Done',
			context_before: [{ line_number: 1, line_content: 'Public' }],
			context_after: [{ line_number: 12, line_content: 'After' }],
		});

		expect(screen.getByText('1')).toBeTruthy();
		expect(screen.getByText('12')).toBeTruthy();
		expect(screen.queryByText('7')).toBeNull();
		expect(screen.queryByText('9')).toBeNull();
	});

	it('renders legacy string context with sequential line numbers', () => {
		renderGrepMatch({
			path: '/notes.md',
			line_number: 8,
			line_content: 'Match',
			context_before: ['Before one', 'Before two'],
			context_after: ['After one', 'After two'],
		});

		expect(screen.getByText('Before one')).toBeTruthy();
		expect(screen.getByText('Before two')).toBeTruthy();
		expect(screen.getByText('After one')).toBeTruthy();
		expect(screen.getByText('After two')).toBeTruthy();
		expect(screen.getByText('6')).toBeTruthy();
		expect(screen.getByText('7')).toBeTruthy();
		expect(screen.getByText('9')).toBeTruthy();
		expect(screen.getByText('10')).toBeTruthy();
	});
});

function renderGrepMatch(match: grep.Match) {
	const toolPart = {
		type: 'tool-grep',
		toolCallId: 'grep-1',
		state: 'output-available',
		input: { pattern: match.line_content },
		output: {
			_version: '1',
			matches: [match],
			total_matches: 1,
			truncated: false,
		},
	} as ToolCallComponentProps<'grep'>['toolPart'];

	render(<GrepToolCall toolPart={toolPart} />);
}
