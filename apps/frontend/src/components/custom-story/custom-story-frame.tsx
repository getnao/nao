import { hasModifier, replayKeydown, snapshotKeydown } from '@nao/shared/keyboard-shortcut';
import {
	EMPTY_STORY_STATE_SNAPSHOT,
	isFromStoryChannel,
	isStoryFrameMessage,
	STORY_CONNECT_MESSAGE,
	STORY_FORWARDED_KEYS,
	STORY_RUNTIME_PATH,
} from '@nao/shared/story-app';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { narrativesOptions, queryDataOptions, querySqlOptions, stateOptions } from './story-data-options';
import { buildStoryFrameDocument } from './story-frame-document';
import { RememberStateHeader } from './remember-state-header';
import { StoryStateHeader } from './story-state-header';
import { savedViewOf, useStoryStateSession } from './use-story-state-session';
import type {
	StoryApp,
	StoryBlockEditPayload,
	StoryFrameMessage,
	StoryHostMessage,
	StoryStateValues,
	StoryTableFormatEditRequest,
} from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { StoryBlockReference } from '@nao/shared/types';

import type { CustomStoryDataSource } from './story-data-options';
import type { StoryRuntimeLocation } from './story-frame-document';
import { useDateFormat } from '@/hooks/use-date-format';
import { getAppWideShortcuts, isTypingTarget } from '@/lib/keyboard-shortcuts';
import { downloadCsv, downloadXlsx, tableToCsv, tableToTsv } from '@/lib/table-export';
import { cn } from '@/lib/utils';

export interface CustomStoryRuntimeError {
	message: string;
	stack?: string;
}

const MAX_EXPORT_FILENAME_LENGTH = 100;

interface CustomStoryFrameProps {
	dataSource: CustomStoryDataSource;
	app: StoryApp;
	styles: string[];
	theme: StoryTheme;
	editable?: boolean;
	onEditBlock?: (request: StoryBlockEditPayload) => void;
	onEditTableFormat?: (request: StoryTableFormatEditRequest) => void;
	onAskBlock?: (block: StoryBlockReference) => void;
	onReady?: () => void;
	onError?: (error: CustomStoryRuntimeError) => void;
	stateControls?: StoryStateControls;
	/** Offered on a story that saves no state yet, to have the agent add it. */
	onRememberState?: () => void;
	className?: string;
}

/** Shown only for a story that saves state; `autoSaveDefault` is what its author set in its manifest. */
export interface StoryStateControls {
	storyId: string;
	usesState: boolean;
	hasLocalState: boolean;
	autoSaveDefault: boolean;
}

const NAVIGATED_AWAY_MESSAGE = 'The story tried to navigate away from its frame and was stopped.';

export function CustomStoryFrame({
	dataSource,
	app,
	styles,
	theme,
	editable = false,
	onEditBlock,
	onEditTableFormat,
	onAskBlock,
	onReady,
	onError,
	stateControls,
	onRememberState,
	className,
}: CustomStoryFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const loadCountRef = useRef(0);
	const isFrameReadyRef = useRef(false);
	const portRef = useRef<MessagePort | null>(null);
	const [navigatedAway, setNavigatedAway] = useState(false);
	const queryClient = useQueryClient();
	const dateFormat = useDateFormat();
	const usesState = stateControls?.usesState ?? false;
	const frameDocument = useStoryFrameDocument(app, styles, theme, dataSource, usesState, onError);
	const srcDoc = frameDocument?.html ?? null;
	const channel = frameDocument?.channel;
	const bootTheme = frameDocument?.theme;

	const reply = useCallback((message: StoryHostMessage) => {
		portRef.current?.postMessage(message);
	}, []);

	const pushStateToFrame = useCallback(
		(values: StoryStateValues) => reply({ type: 'nao-story:state', state: values }),
		[reply],
	);
	const stateSession = useStoryStateSession({
		dataSource,
		storyId: stateControls?.storyId ?? '',
		enabled: usesState,
		autoSaveDefault: stateControls?.autoSaveDefault ?? true,
		pushToFrame: pushStateToFrame,
	});
	const recordStateChange = stateSession.record;

	const syncThemeOnReady = useEffectEvent(() => {
		if (theme !== bootTheme) {
			reply({ type: 'nao-story:theme', theme });
		}
	});

	const connectPort = useCallback((onMessage: (event: MessageEvent<unknown>) => void) => {
		portRef.current?.close();
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = onMessage;
		portRef.current = port1;
		iframeRef.current?.contentWindow?.postMessage({ type: STORY_CONNECT_MESSAGE }, '*', [port2]);
	}, []);

	const closePort = useCallback(() => {
		portRef.current?.close();
		portRef.current = null;
	}, []);

	const answerQuery = useCallback(
		async (requestId: string, queryId: string, fresh: boolean) => {
			try {
				const options = queryDataOptions(dataSource, queryId);
				const result = await queryClient.fetchQuery(fresh ? { ...options, staleTime: 0 } : options);
				reply({ type: 'nao-story:query-result', requestId, result });
			} catch (error) {
				reply({ type: 'nao-story:query-error', requestId, message: describeError(error) });
			}
		},
		[dataSource, queryClient, reply],
	);

	const answerQuerySql = useCallback(
		async (requestId: string, queryId: string) => {
			try {
				const { sqlQuery } = await queryClient.fetchQuery(querySqlOptions(dataSource, queryId));
				reply({ type: 'nao-story:query-sql-result', requestId, sqlQuery });
			} catch (error) {
				reply({ type: 'nao-story:query-sql-error', requestId, message: describeError(error) });
			}
		},
		[dataSource, queryClient, reply],
	);

	const answerNarratives = useCallback(
		async (requestId: string) => {
			const narratives = await queryClient.fetchQuery(narrativesOptions(dataSource)).catch(() => ({}));
			reply({ type: 'nao-story:narratives-result', requestId, narratives });
		},
		[dataSource, queryClient, reply],
	);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<unknown>) => {
			const isFromStory =
				event.source === iframeRef.current?.contentWindow &&
				loadCountRef.current <= 1 &&
				channel !== undefined &&
				isFromStoryChannel(event.data, channel);
			if (!isFromStory || !isStoryFrameMessage(event.data)) {
				return;
			}
			dispatch(event.data);
		};
		const handlePortMessage = (event: MessageEvent<unknown>) => {
			if (isStoryFrameMessage(event.data)) {
				dispatch(event.data);
			}
		};
		const dispatch = (message: StoryFrameMessage) => {
			switch (message.type) {
				case 'nao-story:ready':
					isFrameReadyRef.current = true;
					connectPort(handlePortMessage);
					reply({ type: 'nao-story:editing', enabled: editable });
					reply({ type: 'nao-story:shortcuts', shortcuts: getAppWideShortcuts() });
					syncThemeOnReady();
					onReady?.();
					break;
				case 'nao-story:query':
					void answerQuery(message.requestId, message.queryId, message.fresh === true);
					break;
				case 'nao-story:narratives':
					void answerNarratives(message.requestId);
					break;
				case 'nao-story:error':
					onError?.({ message: message.message, stack: message.stack });
					break;
				case 'nao-story:copy-table':
					if (isUserGesture()) {
						void navigator.clipboard.writeText(tableToTsv(message.columns, message.rows, dateFormat));
					}
					break;
				case 'nao-story:export-table':
					if (isUserGesture()) {
						exportTable(message, dateFormat);
					}
					break;
				case 'nao-story:edit-block':
					if (editable) {
						onEditBlock?.({
							block: message.block,
							config: message.config,
							columns: message.columns,
							rows: message.rows,
							colors: message.colors,
						});
					}
					break;
				case 'nao-story:edit-table-format':
					if (editable) {
						onEditTableFormat?.({
							block: message.block,
							formats: message.formats,
							columns: message.columns,
							rows: message.rows,
						});
					}
					break;
				case 'nao-story:ask-block':
					if (editable) {
						onAskBlock?.(message.block);
					}
					break;
				case 'nao-story:query-sql':
					void answerQuerySql(message.requestId, message.queryId);
					break;
				case 'nao-story:set-state':
					recordStateChange({ key: message.key, value: message.value });
					break;
				case 'nao-story:keydown':
					replayKeydown(document, message);
					break;
			}
		};
		if (portRef.current) {
			portRef.current.onmessage = handlePortMessage;
		}
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [
		answerNarratives,
		answerQuery,
		answerQuerySql,
		channel,
		connectPort,
		dateFormat,
		editable,
		onAskBlock,
		onEditBlock,
		onEditTableFormat,
		onError,
		onReady,
		recordStateChange,
		reply,
	]);

	useEffect(() => {
		if (isFrameReadyRef.current) {
			reply({ type: 'nao-story:editing', enabled: editable });
		}
	}, [editable, reply]);

	useEffect(() => {
		if (isFrameReadyRef.current) {
			reply({ type: 'nao-story:theme', theme });
		}
	}, [theme, reply]);

	useForwardHostKeydown(reply);

	const handleLoad = useCallback(() => {
		loadCountRef.current += 1;
		if (loadCountRef.current > 1) {
			closePort();
			setNavigatedAway(true);
			onError?.({ message: NAVIGATED_AWAY_MESSAGE });
		}
	}, [closePort, onError]);

	useEffect(() => closePort, [closePort]);

	useEffect(() => {
		if (srcDoc !== null) {
			closePort();
			loadCountRef.current = 0;
			isFrameReadyRef.current = false;
			setNavigatedAway(false);
		}
	}, [closePort, srcDoc]);

	if (srcDoc === null) {
		return null;
	}
	if (navigatedAway) {
		return (
			<div className={cn('flex h-full items-center justify-center p-6 text-sm text-muted-foreground', className)}>
				{NAVIGATED_AWAY_MESSAGE}
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col'>
			{stateControls?.usesState ? (
				<StoryStateHeader session={stateSession} />
			) : (
				stateControls?.hasLocalState && onRememberState && <RememberStateHeader onRemember={onRememberState} />
			)}
			<iframe
				ref={iframeRef}
				aria-label='Custom story'
				sandbox='allow-scripts'
				allowFullScreen
				referrerPolicy='no-referrer'
				srcDoc={srcDoc}
				onLoad={handleLoad}
				className={cn('block min-h-0 w-full flex-1 border-0 bg-transparent', className)}
			/>
		</div>
	);
}

interface StoryFrameDocument {
	html: string;
	channel: string;
	theme: StoryTheme;
}

function useStoryFrameDocument(
	app: StoryApp,
	styles: string[],
	theme: StoryTheme,
	dataSource: CustomStoryDataSource,
	usesState: boolean,
	onError?: (error: CustomStoryRuntimeError) => void,
): StoryFrameDocument | null {
	const [frameDocument, setFrameDocument] = useState<StoryFrameDocument | null>(null);
	const queryClient = useQueryClient();
	const reportError = useEffectEvent((error: unknown) => onError?.({ message: describeError(error) }));
	const readTheme = useEffectEvent(() => theme);
	const loadState = useEffectEvent(async (): Promise<StoryStateValues> => {
		if (!usesState) {
			return {};
		}
		const options = stateOptions(dataSource);
		const snapshot = await queryClient
			.fetchQuery(options)
			.catch(() => queryClient.getQueryData(options.queryKey) ?? EMPTY_STORY_STATE_SNAPSHOT);
		return savedViewOf(snapshot, 'mine');
	});
	useEffect(() => {
		let cancelled = false;
		setFrameDocument(null);
		const channel = crypto.randomUUID();
		const bootTheme = readTheme();
		loadState()
			.then((state) =>
				buildStoryFrameDocument({
					app,
					styles,
					theme: bootTheme,
					state,
					runtime: storyRuntimeLocation(),
					channel,
				}),
			)
			.then(
				(html) => {
					if (!cancelled) {
						setFrameDocument({ html, channel, theme: bootTheme });
					}
				},
				(error: unknown) => {
					if (!cancelled) {
						reportError(error);
					}
				},
			);
		return () => {
			cancelled = true;
		};
	}, [app, styles]);
	return frameDocument;
}

function useForwardHostKeydown(reply: (message: StoryHostMessage) => void) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!STORY_FORWARDED_KEYS.includes(event.key)) {
				return;
			}
			if (!event.isTrusted || event.defaultPrevented || hasModifier(event) || isTypingTarget(event)) {
				return;
			}
			reply({ type: 'nao-story:keydown', ...snapshotKeydown(event) });
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [reply]);
}

function storyRuntimeLocation(): StoryRuntimeLocation {
	const origin = window.location.origin;
	return import.meta.env.DEV
		? { baseUrl: `${origin}/src/story-runtime/`, extension: '.ts' }
		: { baseUrl: `${origin}${STORY_RUNTIME_PATH}/`, extension: '.js' };
}

function isUserGesture(): boolean {
	return navigator.userActivation?.isActive ?? false;
}

function exportTable(
	{ format, filename, columns, rows }: Extract<StoryFrameMessage, { type: 'nao-story:export-table' }>,
	dateFormat: ReturnType<typeof useDateFormat>,
) {
	const safeName = toSafeFilename(filename);
	if (format === 'csv') {
		downloadCsv(`${safeName}.csv`, tableToCsv(columns, rows, dateFormat));
	} else {
		void downloadXlsx(`${safeName}.xlsx`, columns, rows, dateFormat);
	}
}

function toSafeFilename(name: string): string {
	const safe = name
		.replace(/[^\p{L}\p{N} ._-]+/gu, '_')
		.replace(/^[.\s]+/, '')
		.slice(0, MAX_EXPORT_FILENAME_LENGTH)
		.trim();
	return safe || 'table';
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : 'The query could not be loaded.';
}
