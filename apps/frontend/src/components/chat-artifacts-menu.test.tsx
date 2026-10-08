// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatArtifactsMenu } from './chat-artifacts-menu';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';

const mocks = vi.hoisted(() => ({
	density: 'detailed' as 'detailed' | 'compact',
	messages: [] as UIMessage[],
	openSidePanel: vi.fn(),
}));

vi.mock('@/hooks/use-tool-call-density', () => ({
	useToolCallDensity: () => [mocks.density, vi.fn(), { canChange: true, isLoading: false }],
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentMessagesSelector: (selector: (messages: UIMessage[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/contexts/side-panel', () => ({
	useSidePanel: () => ({ open: mocks.openSidePanel, currentStorySlug: null, isVisible: false }),
}));

vi.mock('@/components/side-panel/story-viewer', () => ({
	StoryViewer: () => null,
}));

vi.mock('@/components/side-panel/attachment-viewer', () => ({
	AttachmentViewer: () => null,
}));

function assistant(id: string, ...parts: UIMessagePart[]): UIMessage {
	return { id, role: 'assistant', parts };
}

function user(id: string, ...parts: UIMessagePart[]): UIMessage {
	return { id, role: 'user', parts };
}

const storyPart = {
	type: 'tool-story',
	toolCallId: 'call_story',
	state: 'output-available',
	input: { action: 'create', id: 'revenue', title: 'Revenue', code: '# story' },
	output: { _version: '1', success: true, id: 'revenue', version: 1, code: '# story', title: 'Revenue' },
} as unknown as UIMessagePart;

const queryPart = {
	type: 'tool-execute_sql',
	toolCallId: 'call_query',
	state: 'output-available',
	input: { sql_query: 'SELECT 1', name: 'Monthly revenue' },
	output: { _version: '1', id: 'query_a', columns: ['month', 'revenue'], row_count: 12, data: [] },
} as unknown as UIMessagePart;

const filePart = {
	type: 'file',
	url: '/home/uploads/sales.csv',
	filename: 'sales.csv',
	mediaType: 'text/csv',
} as UIMessagePart;

describe('ChatArtifactsMenu', () => {
	beforeEach(() => {
		mocks.density = 'detailed';
		mocks.messages = [user('u1', filePart), assistant('a1', storyPart, queryPart)];
		mocks.openSidePanel.mockReset();
	});
	afterEach(cleanup);

	it('lists stories, files and queries and opens a story in the side panel', () => {
		render(<ChatArtifactsMenu chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Artifacts (3)' }));
		expect(screen.getByText('Stories')).toBeDefined();
		expect(screen.getByText('Files')).toBeDefined();
		expect(screen.getByText('Queries')).toBeDefined();
		expect(screen.getByText('12 rows · 2 cols')).toBeDefined();

		fireEvent.click(screen.getByText('Revenue'));
		expect(mocks.openSidePanel).toHaveBeenCalledWith(expect.anything(), 'revenue');
	});

	it('hides queries for a compact tool call density', () => {
		mocks.density = 'compact';
		render(<ChatArtifactsMenu chatId='chat-1' />);

		fireEvent.click(screen.getByRole('button', { name: 'Artifacts (2)' }));
		expect(screen.queryByText('Queries')).toBeNull();
		expect(screen.getByText('sales.csv')).toBeDefined();
	});

	it('renders nothing when the conversation has no artifacts to show', () => {
		mocks.density = 'compact';
		mocks.messages = [assistant('a1', queryPart)];
		const { container } = render(<ChatArtifactsMenu chatId='chat-1' />);

		expect(container.innerHTML).toBe('');
	});
});
