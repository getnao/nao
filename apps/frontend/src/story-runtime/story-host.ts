import { isStoryHostMessage } from '@nao/shared/story-app';
import { Component, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveBlockColors } from './story-colors';
import type { ErrorInfo, ReactNode } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';
import type {
	StoryBlockEditRequest,
	StoryFrameMessage,
	StoryQueryResult,
	StoryTableExportFormat,
} from '@nao/shared/story-app';

interface BootOptions {
	source: string;
	theme: StoryTheme;
}

interface PendingQuery {
	resolve: (result: StoryQueryResult) => void;
	reject: (error: Error) => void;
}

const pendingQueries = new Map<string, PendingQuery>();
const editingListeners = new Set<() => void>();
let activeTheme: StoryTheme | null = null;
let editingEnabled = false;

export async function bootStory({ source, theme }: BootOptions): Promise<void> {
	activeTheme = theme;
	installGlobalErrorReporting();
	const container = document.getElementById('root');
	if (!container) {
		throw new Error('Story frame is missing its #root element.');
	}

	try {
		const App = await loadStoryComponent(source);
		createRoot(container).render(createElement(StoryErrorBoundary, null, createElement(App)));
		send({ type: 'nao-story:ready' });
	} catch (error) {
		reportError(error);
		container.replaceChildren(renderCrash(error));
	}
}

export function requestQueryData(queryId: string): Promise<StoryQueryResult> {
	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		pendingQueries.set(requestId, { resolve, reject });
		send({ type: 'nao-story:query', requestId, queryId });
	});
}

export function getStoryTheme(): StoryTheme | null {
	return activeTheme;
}

export function copyTable(columns: string[], rows: Record<string, unknown>[]): void {
	send({ type: 'nao-story:copy-table', columns, rows });
}

export function exportTable(
	format: StoryTableExportFormat,
	filename: string,
	columns: string[],
	rows: Record<string, unknown>[],
): void {
	send({ type: 'nao-story:export-table', format, filename, columns, rows });
}

export function isEditingEnabled(): boolean {
	return editingEnabled;
}

export function subscribeToEditing(listener: () => void): () => void {
	editingListeners.add(listener);
	return () => {
		editingListeners.delete(listener);
	};
}

export function requestBlockEdit({ block, config, columns, rows }: StoryBlockEditRequest): void {
	send({
		type: 'nao-story:edit-block',
		block: { component: block.component, props: toJsonSafe(block.props) },
		config,
		columns,
		rows: toJsonSafe(rows),
		colors: resolveBlockColors(config),
	});
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
	if (event.source !== window.parent || !isStoryHostMessage(event.data)) {
		return;
	}
	if (event.data.type === 'nao-story:editing') {
		editingEnabled = event.data.enabled;
		editingListeners.forEach((listener) => listener());
		return;
	}
	const pending = pendingQueries.get(event.data.requestId);
	if (!pending) {
		return;
	}
	pendingQueries.delete(event.data.requestId);
	if (event.data.type === 'nao-story:query-result') {
		pending.resolve(event.data.result);
	} else {
		pending.reject(new Error(event.data.message));
	}
});

function send(message: StoryFrameMessage): void {
	window.parent.postMessage(message, '*');
}

function toJsonSafe<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** The bundle arrives as text; a same-frame blob URL turns it into an importable module without any network hop. */
async function loadStoryComponent(source: string): Promise<() => ReactNode> {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	try {
		const module = (await import(/* @vite-ignore */ url)) as { default?: unknown };
		if (typeof module.default !== 'function') {
			throw new Error('The entry file must default-export a React component.');
		}
		return module.default as () => ReactNode;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function installGlobalErrorReporting(): void {
	window.addEventListener('error', (event) => reportError(event.error ?? event.message));
	window.addEventListener('unhandledrejection', (event) => reportError(event.reason));
}

function reportError(error: unknown): void {
	const normalized = error instanceof Error ? error : new Error(String(error));
	send({ type: 'nao-story:error', message: normalized.message, stack: normalized.stack });
}

function renderCrash(error: unknown): HTMLElement {
	const box = document.createElement('pre');
	box.className = 'nao-story-crash';
	box.textContent = error instanceof Error ? error.message : String(error);
	return box;
}

class StoryErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		reportError(new Error(`${error.message}${info.componentStack ?? ''}`));
	}

	render() {
		if (this.state.error) {
			return createElement('pre', { className: 'nao-story-crash' }, this.state.error.message);
		}
		return this.props.children;
	}
}
