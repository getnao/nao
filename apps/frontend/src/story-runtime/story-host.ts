import { isStoryHostMessage } from '@nao/shared/story-app';
import { Component, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ErrorInfo, ReactNode } from 'react';
import type { StoryFrameMessage, StoryQueryResult } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

interface BootOptions {
	source: string;
	theme: StoryTheme;
}

interface PendingQuery {
	resolve: (result: StoryQueryResult) => void;
	reject: (error: Error) => void;
}

const pendingQueries = new Map<string, PendingQuery>();
let activeTheme: StoryTheme | null = null;

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

window.addEventListener('message', (event: MessageEvent<unknown>) => {
	if (event.source !== window.parent || !isStoryHostMessage(event.data)) {
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
