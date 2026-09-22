// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GrepToolCall } from './grep';
import type { ToolCallComponentProps } from '.';
import type { ReactNode } from 'react';

vi.mock('@/contexts/tool-call', () => ({
	useToolCallContext: () => ({ isSettled: true }),
}));

vi.mock('./tool-call-wrapper', () => ({
	ToolCallWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

describe('GrepToolCall', () => {
	it('renders source line numbers carried by context rows', () => {
		const toolPart = {
			type: 'tool-grep',
			toolCallId: 'grep-1',
			state: 'output-available',
			input: { pattern: 'Done' },
			output: {
				_version: '1',
				matches: [
					{
						path: '/RULES.md',
						line_number: 8,
						line_content: 'Done',
						context_before: [{ line_number: 1, line_content: 'Public' }],
						context_after: [{ line_number: 12, line_content: 'After' }],
					},
				],
				total_matches: 1,
				truncated: false,
			},
		} as ToolCallComponentProps<'grep'>['toolPart'];

		render(<GrepToolCall toolPart={toolPart} />);

		expect(screen.getByText('1')).toBeTruthy();
		expect(screen.getByText('12')).toBeTruthy();
		expect(screen.queryByText('7')).toBeNull();
		expect(screen.queryByText('9')).toBeNull();
	});

	it('renders legacy string context with sequential line numbers', () => {
		const toolPart = {
			type: 'tool-grep',
			toolCallId: 'grep-legacy',
			state: 'output-available',
			input: { pattern: 'Match' },
			output: {
				_version: '1',
				matches: [
					{
						path: '/notes.md',
						line_number: 8,
						line_content: 'Match',
						context_before: ['Before one', 'Before two'],
						context_after: ['After one', 'After two'],
					},
				],
				total_matches: 1,
				truncated: false,
			},
		} as ToolCallComponentProps<'grep'>['toolPart'];

		render(<GrepToolCall toolPart={toolPart} />);

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
