import { matchesShortcut, replayKeydown, snapshotKeydown } from '@nao/shared/keyboard-shortcut';
import {
	isStoryConnectMessage,
	isStoryHostMessage,
	STORY_HTML_API_GLOBAL,
	STORY_PRINT_FLAG,
} from '@nao/shared/story-app';
import { STORY_THEME_STYLE_ID, storyThemeStyles } from '@nao/shared/story-document';
import { Component, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveBlockColors } from './story-colors';
import {
	initStoryState,
	readStorySaveStatus,
	readStoryState,
	replaceStorySaveStatus,
	replaceStoryState,
	subscribeToStoryState,
	writeStoryState,
} from './story-state';
import type { ErrorInfo, ReactNode } from 'react';
import type { Shortcut } from '@nao/shared/keyboard-shortcut';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { StoryBlockReference } from '@nao/shared/types';
import type {
	StoryAppKind,
	StoryBlockEditRequest,
	StoryTableFormatEditRequest,
	StoryExportData,
	StoryFrameMessage,
	StoryHostMessage,
	StoryHtmlApi,
	StoryNarratives,
	StoryQueryResult,
	StoryStateValues,
	StoryTableExportFormat,
} from '@nao/shared/story-app';

interface BootOptions {
	kind?: StoryAppKind;
	source: string;
	theme: StoryTheme;
	exportData?: StoryExportData;
	state?: StoryStateValues;
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
const themeListeners = new Set<() => void>();
let activeTheme: StoryTheme | null = null;
let editingEnabled = false;
let exportData: StoryExportData | null = null;
let frameChannel: string | undefined;
let hostPort: MessagePort | null = null;
let hostShortcuts: Shortcut[] = [];

export async function bootStory({
	kind = 'react',
	source,
	theme,
	exportData: embeddedData,
	state,
	channel,
}: BootOptions): Promise<void> {
	activeTheme = theme;
	frameChannel = channel;
	exportData = embeddedData ?? null;
	bootStoryState(state);
	installGlobalErrorReporting();

	try {
		if (kind === 'html') {
			await runHtmlStory(source);
		} else {
			await mountReactStory(source);
		}
		send({ type: 'nao-story:ready' });
		document.documentElement.dataset.naoStoryReady = 'true';
	} catch (error) {
		reportError(error);
		showCrash(error);
	}
}

async function mountReactStory(source: string): Promise<void> {
	const container = document.getElementById('root');
	if (!container) {
		throw new Error('Story frame is missing its #root element.');
	}
	const App = await loadStoryComponent(source);
	createRoot(container).render(createElement(StoryErrorBoundary, null, createElement(App)));
}

/** An HTML story's scripts were bundled into `source` at build time; they reach the host through the `nao` global. */
async function runHtmlStory(source: string): Promise<void> {
	exposeHtmlApi();
	if (source.trim() !== '') {
		await importStoryModule(source);
	}
}

function exposeHtmlApi(): void {
	const api: StoryHtmlApi = {
		query: requestQueryData,
		querySql: requestQuerySql,
		narratives: requestNarratives,
		theme: getStoryTheme,
		onTheme: (listener) =>
			subscribeToTheme(() => {
				if (activeTheme) {
					listener(activeTheme);
				}
			}),
		isExport: isStoryExport,
		isPrint: isPrintMode,
		state: {
			get: readStoryState,
			set: writeStoryState,
			save: requestStateSave,
			discard: requestStateDiscard,
			saveStatus: readStorySaveStatus,
			onSaveStatus: (listener) => subscribeToStoryState(() => listener(readStorySaveStatus())),
		},
	};
	Object.defineProperty(globalThis, STORY_HTML_API_GLOBAL, { value: Object.freeze(api), enumerable: true });
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

export function subscribeToTheme(listener: () => void): () => void {
	themeListeners.add(listener);
	return () => {
		themeListeners.delete(listener);
	};
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

export function requestStateSave(): void {
	if (!exportData) {
		send({ type: 'nao-story:save-state' });
	}
}

export function requestStateDiscard(): void {
	if (!exportData) {
		send({ type: 'nao-story:discard-state' });
	}
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
	const isConnect =
		event.source === window.parent &&
		hostPort === null &&
		event.ports.length === 1 &&
		isStoryConnectMessage(event.data);
	if (!isConnect) {
		return;
	}
	hostPort = event.ports[0];
	hostPort.onmessage = (portEvent: MessageEvent<unknown>) => handleHostMessage(portEvent.data);
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
	if (!event.isTrusted || !hostShortcuts.some((shortcut) => matchesShortcut(event, shortcut))) {
		return;
	}
	event.preventDefault();
	send({ type: 'nao-story:keydown', ...snapshotKeydown(event) });
});

function handleHostMessage(message: unknown): void {
	if (!isStoryHostMessage(message)) {
		return;
	}
	if (message.type === 'nao-story:editing') {
		editingEnabled = message.enabled;
		editingListeners.forEach((listener) => listener());
		return;
	}
	if (message.type === 'nao-story:theme') {
		applyTheme(message.theme);
		return;
	}
	if (message.type === 'nao-story:shortcuts') {
		hostShortcuts = message.shortcuts;
		return;
	}
	if (message.type === 'nao-story:state') {
		replaceStoryState(message.state);
		return;
	}
	if (message.type === 'nao-story:save-status') {
		replaceStorySaveStatus({ hasChanges: message.hasChanges, isSaving: message.isSaving, error: message.error });
		return;
	}
	if (message.type === 'nao-story:keydown') {
		replayKeydown(window, message);
		return;
	}
	if (message.type === 'nao-story:narratives-result') {
		pendingNarratives.get(message.requestId)?.resolve(message.narratives);
		pendingNarratives.delete(message.requestId);
		return;
	}
	if (message.type === 'nao-story:query-sql-result' || message.type === 'nao-story:query-sql-error') {
		settleQuerySql(message);
		return;
	}
	const pending = pendingQueries.get(message.requestId);
	if (!pending) {
		return;
	}
	pendingQueries.delete(message.requestId);
	if (message.type === 'nao-story:query-result') {
		pending.resolve(message.result);
	} else {
		pending.reject(new Error(message.message));
	}
}

function applyTheme(theme: StoryTheme): void {
	activeTheme = theme;
	const themeStyle = document.getElementById(STORY_THEME_STYLE_ID);
	if (themeStyle) {
		themeStyle.textContent = storyThemeStyles(theme);
	}
	for (const href of theme.text.fontStylesheets) {
		ensureFontStylesheet(href);
	}
	themeListeners.forEach((listener) => listener());
}

function ensureFontStylesheet(href: string): void {
	const loaded = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
	if (loaded.some((link) => link.href === href)) {
		return;
	}
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	document.head.appendChild(link);
}

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

function bootStoryState(state: StoryStateValues | undefined): void {
	if (exportData) {
		initStoryState(exportData.state, null);
		return;
	}
	initStoryState(state, ({ key, value }) => send({ type: 'nao-story:set-state', key, value: toJsonSafe(value) }));
}

function send(message: StoryFrameMessage): void {
	if (hostPort) {
		hostPort.postMessage(message);
	} else {
		window.parent.postMessage({ ...message, channel: frameChannel }, '*');
	}
}

function readExportedQuery(data: StoryExportData, queryId: string): Promise<StoryQueryResult> {
	const result = data.queries[queryId];
	return result ? Promise.resolve(result) : Promise.reject(new Error(`Query ${queryId} is not part of this export.`));
}

function toJsonSafe<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

async function loadStoryComponent(source: string): Promise<() => ReactNode> {
	const module = await importStoryModule(source);
	if (typeof module.default !== 'function') {
		throw new Error('The entry file must default-export a React component.');
	}
	return module.default as () => ReactNode;
}

/** The bundle arrives as text; a same-frame blob URL turns it into an importable module without any network hop. */
async function importStoryModule(source: string): Promise<{ default?: unknown }> {
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	try {
		return (await import(/* @vite-ignore */ url)) as { default?: unknown };
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

function showCrash(error: unknown): void {
	const box = document.createElement('pre');
	box.className = 'nao-story-crash';
	box.textContent = error instanceof Error ? error.message : String(error);
	const container = document.getElementById('root');
	if (container) {
		container.replaceChildren(box);
	} else {
		document.body.prepend(box);
	}
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
