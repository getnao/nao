import { isStoryHostMessage, STORY_PRINT_FLAG } from '@nao/shared/story-app';
import { Component, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveBlockColors } from './story-colors';
import type { ErrorInfo, ReactNode } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { StoryBlockReference } from '@nao/shared/types';
import type {
	StoryBlockEditRequest,
	StoryTableFormatEditRequest,
	StoryExportData,
	StoryFrameMessage,
	StoryHostMessage,
	StoryNarratives,
	StoryQueryResult,
	StoryTableExportFormat,
} from '@nao/shared/story-app';

interface BootOptions {
	source: string;
	theme: StoryTheme;
	exportData?: StoryExportData;
	channel?: string;
}

interface PendingRequest<T> {
	resolve: (result: T) => void;
	reject: (error: Error) => void;
}

const HOST_REPLY_TIMEOUT_MS = 120_000;

const pendingQueries = new Map<string, PendingRequest<StoryQueryResult>>();
const pendingQuerySql = new Map<string, PendingRequest<string>>();
const pendingNarratives = new Map<string, PendingRequest<StoryNarratives>>();
const editingListeners = new Set<() => void>();
let activeTheme: StoryTheme | null = null;
let editingEnabled = false;
let exportData: StoryExportData | null = null;
let frameChannel: string | undefined;

export async function bootStory({ source, theme, exportData: embeddedData, channel }: BootOptions): Promise<void> {
	activeTheme = theme;
	frameChannel = channel;
	exportData = embeddedData ?? null;
	installGlobalErrorReporting();
	const container = document.getElementById('root');
	if (!container) {
		throw new Error('Story frame is missing its #root element.');
	}

	try {
		const App = await loadStoryComponent(source);
		createRoot(container).render(createElement(StoryErrorBoundary, null, createElement(App)));
		send({ type: 'nao-story:ready' });
		document.documentElement.dataset.naoStoryReady = 'true';
	} catch (error) {
		reportError(error);
		container.replaceChildren(renderCrash(error));
	}
}

export function requestQueryData(
	queryId: string,
	{ fresh = false }: { fresh?: boolean } = {},
): Promise<StoryQueryResult> {
	if (exportData) {
		return readExportedQuery(exportData, queryId);
	}
	return awaitReply(pendingQueries, (requestId) => ({ type: 'nao-story:query', requestId, queryId, fresh }));
}

export function requestNarratives(): Promise<StoryNarratives> {
	if (exportData) {
		return Promise.resolve(exportData.narratives);
	}
	return awaitReply(pendingNarratives, (requestId) => ({ type: 'nao-story:narratives', requestId })).catch(
		(): StoryNarratives => ({}),
	);
}

export function isStoryExport(): boolean {
	return exportData !== null;
}

export function isPrintMode(): boolean {
	return (globalThis as { [STORY_PRINT_FLAG]?: unknown })[STORY_PRINT_FLAG] === true;
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

export function requestTableFormatEdit({ block, formats, columns, rows }: StoryTableFormatEditRequest): void {
	send({
		type: 'nao-story:edit-table-format',
		block: { component: block.component, props: toJsonSafe(block.props) },
		formats: toJsonSafe(formats),
		columns,
		rows: toJsonSafe(rows),
	});
}

export function requestBlockAsk(block: StoryBlockReference): void {
	send({ type: 'nao-story:ask-block', block });
}

export function requestQuerySql(queryId: string): Promise<string> {
	return awaitReply(pendingQuerySql, (requestId) => ({ type: 'nao-story:query-sql', requestId, queryId }));
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
	if (event.data.type === 'nao-story:narratives-result') {
		pendingNarratives.get(event.data.requestId)?.resolve(event.data.narratives);
		pendingNarratives.delete(event.data.requestId);
		return;
	}
	if (event.data.type === 'nao-story:query-sql-result' || event.data.type === 'nao-story:query-sql-error') {
		settleQuerySql(event.data);
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

function settleQuerySql(
	message: Extract<StoryHostMessage, { type: 'nao-story:query-sql-result' | 'nao-story:query-sql-error' }>,
): void {
	const pending = pendingQuerySql.get(message.requestId);
	pendingQuerySql.delete(message.requestId);
	if (message.type === 'nao-story:query-sql-result') {
		pending?.resolve(message.sqlQuery);
	} else {
		pending?.reject(new Error(message.message));
	}
}

/** A reply that never comes (host navigated away, message dropped) fails the request instead of loading forever. */
function awaitReply<T>(
	pending: Map<string, PendingRequest<T>>,
	buildMessage: (requestId: string) => StoryFrameMessage,
): Promise<T> {
	const requestId = crypto.randomUUID();
	return new Promise<T>((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			pending.delete(requestId);
			reject(new Error('The story did not get an answer in time. Retry to load it again.'));
		}, HOST_REPLY_TIMEOUT_MS);
		pending.set(requestId, {
			resolve: (result) => {
				window.clearTimeout(timeout);
				resolve(result);
			},
			reject: (error) => {
				window.clearTimeout(timeout);
				reject(error);
			},
		});
		send(buildMessage(requestId));
	});
}

function send(message: StoryFrameMessage): void {
	window.parent.postMessage({ ...message, channel: frameChannel }, '*');
}

function readExportedQuery(data: StoryExportData, queryId: string): Promise<StoryQueryResult> {
	const result = data.queries[queryId];
	return result ? Promise.resolve(result) : Promise.reject(new Error(`Query ${queryId} is not part of this export.`));
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
