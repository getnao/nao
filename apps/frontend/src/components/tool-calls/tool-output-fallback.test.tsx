// @vitest-environment jsdom

/**
 * A tool call with no output must not look the same when it is running and when its output is
 * never going to arrive. Every SQL/Python/app-db body rendered the in-flight placeholder for
 * both, so a dropped stream showed "Executing query..." forever and the only way out was a
 * manual reload — see the header comment in `tool-output-fallback.tsx`.
 *
 * The per-component tests below are the non-vacuous half: each one renders the real component
 * with `isSettled: true` and no output, and fails if its running label comes back.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolOutputFallback } from './tool-output-fallback';
import { ExecuteSqlToolCall } from './execute-sql';
import { QueryAppDbToolCall } from './query-app-db';
import { ExecutePythonToolCall } from './execute-python';
import type { ToolCallComponentProps } from '.';
import { ToolCallProvider } from '@/contexts/tool-call';

vi.mock('@/contexts/side-panel', () => ({
	useSidePanel: () => ({ open: vi.fn(), currentStorySlug: null, isVisible: false }),
}));

// `TableDisplay` reaches `@/hooks/use-date-format`, which imports `@/main` and would execute the
// real app bootstrap (it mounts on a `#app` element that does not exist under jsdom).
vi.mock('@/hooks/use-date-format', () => ({
	useDateFormat: () => ({ preset: 'european' }),
}));
vi.mock('@/main', () => ({
	trpc: {
		analyticsEvent: { logChatDownload: { mutationOptions: () => ({ mutationFn: async () => undefined }) } },
	},
}));

const MISSING_TEXT = /No result reached this tab/;

type AnyToolPart = ToolCallComponentProps['toolPart'];

const partWithoutOutput = (type: string, input: Record<string, unknown>): AnyToolPart =>
	({
		type,
		toolCallId: 'call-1',
		state: 'input-available',
		input,
	}) as unknown as AnyToolPart;

const renderIn = (node: React.ReactNode, toolPart: AnyToolPart, isSettled: boolean) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ToolCallProvider value={{ toolPart, isSettled }}>{node}</ToolCallProvider>
		</QueryClientProvider>,
	);

describe('ToolOutputFallback', () => {
	afterEach(cleanup);

	it('shows the running label while the call is in flight', () => {
		renderIn(
			<ToolOutputFallback runningLabel='Executing query...' />,
			partWithoutOutput('tool-execute_sql', {}),
			false,
		);

		expect(screen.getByText('Executing query...')).toBeDefined();
		expect(screen.queryByText(MISSING_TEXT)).toBeNull();
		expect(screen.queryByRole('button', { name: /Reload page/ })).toBeNull();
	});

	it('replaces the running label with a recoverable state once the message has settled', () => {
		renderIn(
			<ToolOutputFallback runningLabel='Executing query...' />,
			partWithoutOutput('tool-execute_sql', {}),
			true,
		);

		expect(screen.queryByText('Executing query...')).toBeNull();
		expect(screen.getByText(MISSING_TEXT)).toBeDefined();
		expect(screen.getByRole('button', { name: /Reload page/ })).toBeDefined();
	});
});

// Each entry: the component, the tool part it needs, and the label that must NOT survive a
// settled-without-output render. `viewMode` defaults to results in all three, so an input with no
// SQL/code keeps the render on the branch under test.
const cases = [
	{
		name: 'ExecuteSqlToolCall',
		runningLabel: 'Executing query...',
		render: (toolPart: AnyToolPart) => <ExecuteSqlToolCall toolPart={toolPart as never} />,
		toolPart: partWithoutOutput('tool-execute_sql', { name: 'Revenue by product' }),
	},
	{
		name: 'QueryAppDbToolCall',
		runningLabel: 'Executing query...',
		render: (toolPart: AnyToolPart) => <QueryAppDbToolCall toolPart={toolPart} />,
		toolPart: partWithoutOutput('tool-query_app_db', {}),
	},
	{
		name: 'ExecutePythonToolCall',
		runningLabel: 'Executing Python...',
		render: (toolPart: AnyToolPart) => <ExecutePythonToolCall toolPart={toolPart as never} />,
		toolPart: partWithoutOutput('tool-execute_python', {}),
	},
];

// These bodies live inside a collapsed `ToolCallWrapper`, and its Radix accordion does not mount
// the content until it is open — the same reason the defect is only visible to a user who has
// expanded the tool block. Open it first, then assert on what is inside.
const renderExpanded = (node: React.ReactNode, toolPart: AnyToolPart, isSettled: boolean) => {
	const view = renderIn(node, toolPart, isSettled);
	const trigger = view.container.querySelector('button');
	expect(trigger).not.toBeNull();
	fireEvent.click(trigger as HTMLButtonElement);
	return view;
};

describe.each(cases)('$name with no output', ({ render: renderComponent, toolPart, runningLabel }) => {
	afterEach(cleanup);

	it(`still shows "${runningLabel}" while unsettled`, () => {
		renderExpanded(renderComponent(toolPart), toolPart, false);
		expect(screen.getByText(runningLabel)).toBeDefined();
	});

	it('shows the missing-result state instead once settled', () => {
		renderExpanded(renderComponent(toolPart), toolPart, true);

		expect(screen.queryByText(runningLabel)).toBeNull();
		expect(screen.getByText(MISSING_TEXT)).toBeDefined();
	});
});
