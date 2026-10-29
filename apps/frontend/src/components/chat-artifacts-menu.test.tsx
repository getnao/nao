// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatArtifactsMenu } from './chat-artifacts-menu';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';

const mocks = vi.hoisted(() => ({
	density: 'detailed' as 'detailed' | 'compact',
	messages: [] as UIMessage[],
	openSidePanel: vi.fn(),
	openMentionedStory: vi.fn(),
	mentionedStories: [] as { storyId: string; title: string }[],
}));

vi.mock('@/hooks/use-mentioned-stories', () => ({
	useMentionedStories: () => mocks.mentionedStories,
	useOpenMentionedStory: () => mocks.openMentionedStory,
}));

vi.mock('@/components/side-panel/open-story-in-side-panel', () => ({
	useOpenStoryInSidePanel: () => vi.fn(),
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

const WIDE_COLUMN = 1600;
const NARROW_COLUMN = 1000;

class ResizeObserverMock {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(target: Element) {
		this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
	}
	unobserve() {}
	disconnect() {}
}

function renderMenu(columnWidth: number) {
	const column = document.createElement('div');
	Object.defineProperty(column, 'clientWidth', { value: columnWidth });
	document.body.appendChild(column);
	return render(<ChatArtifactsMenu chatId='chat-1' chatColumnRef={{ current: column }} />, { container: column });
}

describe('ChatArtifactsMenu', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', ResizeObserverMock);
		mocks.density = 'detailed';
		mocks.messages = [user('u1', filePart), assistant('a1', storyPart, queryPart)];
		mocks.openSidePanel.mockReset();
		mocks.openMentionedStory.mockReset();
		mocks.mentionedStories = [];
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('docks the panel without a toggle beside a wide chat when the conversation has a story', () => {
		renderMenu(WIDE_COLUMN);

		expect(screen.queryByRole('button', { name: 'Library (3)' })).toBeNull();
		expect(screen.getByText('Library')).toBeDefined();
		expect(screen.getByText('Stories')).toBeDefined();
		expect(screen.getByText('Files')).toBeDefined();
		expect(screen.getByText('Queries')).toBeDefined();
	});

	it('lists the stories the conversation mentions with its own stories, and opens them', () => {
		mocks.messages = [user('u1', filePart)];
		mocks.mentionedStories = [{ storyId: 'story-1', title: 'Top customers' }];
		renderMenu(WIDE_COLUMN);

		expect(screen.getByText('Stories')).toBeDefined();
		expect(screen.queryByText('Mentioned stories')).toBeNull();
		fireEvent.click(screen.getByText('Top customers'));
		expect(mocks.openMentionedStory).toHaveBeenCalledWith({ storyId: 'story-1', title: 'Top customers' });
	});

	it('stays collapsed when the panel would overlap the chat', () => {
		renderMenu(NARROW_COLUMN);

		expect(screen.getByRole('button', { name: 'Library (3)' }).getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('Stories')).toBeNull();
	});

	it('keeps the collapsed toggle without a story even when there is room', () => {
		mocks.messages = [user('u1', filePart), assistant('a1', queryPart)];
		renderMenu(WIDE_COLUMN);

		expect(screen.getByRole('button', { name: 'Library (2)' }).getAttribute('aria-expanded')).toBe('false');
	});

	it('lists artifacts on demand, keeps queries collapsed and opens a story in the side panel', () => {
		renderMenu(NARROW_COLUMN);

		fireEvent.click(screen.getByRole('button', { name: 'Library (3)' }));
		expect(screen.getByText('Stories')).toBeDefined();
		expect(screen.getByText('Files')).toBeDefined();
		expect(screen.queryByText('12 rows · 2 cols')).toBeNull();

		fireEvent.click(screen.getByText('Queries'));
		expect(screen.getByText('12 rows · 2 cols')).toBeDefined();

		fireEvent.click(screen.getByText('Revenue'));
		expect(mocks.openSidePanel).toHaveBeenCalledWith(expect.anything(), 'revenue');
		expect(screen.queryByText('Stories')).toBeNull();
	});

	it('expands, scrolls to and outlines the query result it reveals', () => {
		vi.stubGlobal('CSS', { escape: (value: string) => value });
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		const toolCall = document.createElement('div');
		toolCall.dataset.replayTargetId = 'call_query';
		toolCall.scrollIntoView = vi.fn();
		const trigger = document.createElement('button');
		trigger.setAttribute('aria-expanded', 'false');
		const expand = vi.fn();
		trigger.addEventListener('click', expand);
		toolCall.appendChild(trigger);
		document.body.appendChild(toolCall);
		renderMenu(NARROW_COLUMN);

		fireEvent.click(screen.getByRole('button', { name: 'Library (3)' }));
		fireEvent.click(screen.getByText('Queries'));
		fireEvent.click(screen.getByText('Monthly revenue'));

		expect(expand).toHaveBeenCalled();
		expect(toolCall.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
		expect(toolCall.classList.contains('chat-artifact-reveal-highlight')).toBe(true);
		toolCall.remove();
	});

	it('closes the expanded panel on Escape and on a click outside', () => {
		renderMenu(NARROW_COLUMN);
		const toggle = screen.getByRole('button', { name: 'Library (3)' });

		fireEvent.click(toggle);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByText('Stories')).toBeNull();

		fireEvent.click(toggle);
		fireEvent.pointerDown(screen.getByText('Stories'));
		expect(screen.getByText('Stories')).toBeDefined();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByText('Stories')).toBeNull();
	});

	it('hides queries for a compact tool call density', () => {
		mocks.density = 'compact';
		renderMenu(NARROW_COLUMN);

		fireEvent.click(screen.getByRole('button', { name: 'Library (2)' }));
		expect(screen.queryByText('Queries')).toBeNull();
		expect(screen.getByText('sales.csv')).toBeDefined();
	});

	it('renders nothing when the conversation has no artifacts to show', () => {
		mocks.density = 'compact';
		mocks.messages = [assistant('a1', queryPart)];
		const { container } = renderMenu(WIDE_COLUMN);

		expect(container.innerHTML).toBe('');
	});
});
