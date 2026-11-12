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
import { hasStoryQueryInputs, storyQueryRequestKey, storySqlRequestKey } from '@nao/shared/story-query-inputs';
import {
	fetchChartPluginSource,
	narrativesOptions,
	queryDataOptions,
	modelsOptions,
	querySqlOptions,
	runStoryModel,
	runStorySql,
	stateOptions,
} from './story-data-options';
import { buildStoryFrameDocument } from './story-frame-document';
import { rememberRequestAnswer } from './story-request-answers';
import { RememberStateHeader } from './remember-state-header';
import { useStoryStateRecorder } from './use-story-state-recorder';
import type { StoryModelRequest } from '@nao/shared/story-models';
import type { StoryQueryInputs } from '@nao/shared/story-query-inputs';
import type {
	StoryApp,
	StoryBlockEditPayload,
	StoryElementCitation,
	StoryFrameMessage,
	StoryHostMessage,
	StorySqlRequest,
	StoryStateSnapshot,
	StoryTableFormatEditRequest,
} from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { CustomStoryDataSource } from './story-data-options';
import type { StoryRuntimeLocation } from './story-frame-document';
import { useDateFormat } from '@/hooks/use-date-format';
import { useSession } from '@/lib/auth-client';
import { readBlockAsk, readStoryElementAsk } from '@/lib/story-element-ask';
import { getAppWideShortcuts, isTypingTarget } from '@/lib/keyboard-shortcuts';
import { downloadCsv, downloadXlsx, tableToCsv, tableToTsv } from '@/lib/table-export';
import { cn } from '@/lib/utils';
import { isStoryRequestFresh, useStoryHighlightRequest } from '@/stores/story-highlight';

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
	onAsk?: (citation: StoryElementCitation) => void;
	isSelectingElements?: boolean;
	onReady?: () => void;
	onError?: (error: CustomStoryRuntimeError) => void;
	stateControls?: StoryStateControls;
	/** Offered on a story that saves no state yet, to have the agent add it. */
	onRememberState?: () => void;
	className?: string;
}

export interface StoryStateControls {
	usesState: boolean;
	hasLocalState: boolean;
}

/**
 * Story SQL and filtered reruns read rows with the viewer's own access, which other viewers may not have: once a
 * story has read some, it can no longer write the state every viewer reads.
 */
const SHARED_STATE_AFTER_VIEWER_ROWS_MESSAGE =
	'This story read data with your own access, so it cannot change the state other viewers see until it is reloaded.';

const NAVIGATED_AWAY_MESSAGE = 'The story tried to navigate away from its frame and was stopped.';

export function CustomStoryFrame({
	dataSource,
	app,
	styles,
	theme,
	editable = false,
	onEditBlock,
	onEditTableFormat,
	onAsk,
	isSelectingElements = false,
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
	const hasReadViewerRowsRef = useRef(false);
	const [navigatedAway, setNavigatedAway] = useState(false);
	const queryClient = useQueryClient();
	const viewerId = useSession().data?.user.id ?? '';
	const dateFormat = useDateFormat();
	const usesState = stateControls?.usesState ?? false;
	const isAskable = onAsk !== undefined;
	const frameDocument = useStoryFrameDocument(app, styles, theme, dataSource, usesState, onError);
	const srcDoc = frameDocument?.html ?? null;
	const channel = frameDocument?.channel;
	const bootTheme = frameDocument?.theme;

	const reply = useCallback((message: StoryHostMessage) => {
		portRef.current?.postMessage(message);
	}, []);

	const reportStateError = useCallback((message: string) => onError?.({ message }), [onError]);
	const recordStateChange = useStoryStateRecorder(dataSource, reportStateError);

	const highlightRequest = useStoryHighlightRequest();
	const handledHighlightId = useRef<number | null>(null);
	const forwardHighlight = useEffectEvent(() => {
		const isForThisStory =
			highlightRequest &&
			(!highlightRequest.storySlug || highlightRequest.storySlug === storySlugOf(dataSource)) &&
			isStoryRequestFresh(highlightRequest);
		if (!isForThisStory || !isFrameReadyRef.current || handledHighlightId.current === highlightRequest.id) {
			return;
		}
		handledHighlightId.current = highlightRequest.id;
		reply({ type: 'nao-story:highlight', ...highlightRequest.element });
	});

	useEffect(() => {
		forwardHighlight();
	}, [highlightRequest]);

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
		async (requestId: string, queryId: string, fresh: boolean, inputs?: StoryQueryInputs) => {
			try {
				if (hasStoryQueryInputs(inputs)) {
					hasReadViewerRowsRef.current = true;
				}
				const options = queryDataOptions(dataSource, queryId, inputs);
				const result = await queryClient.fetchQuery(fresh ? { ...options, staleTime: 0 } : options);
				if (hasStoryQueryInputs(inputs)) {
					rememberRequestAnswer(viewerId, dataSource, storyQueryRequestKey(queryId, inputs), result);
				}
				reply({ type: 'nao-story:query-result', requestId, result });
			} catch (error) {
				reply({ type: 'nao-story:query-error', requestId, message: describeError(error) });
			}
		},
		[dataSource, queryClient, reply, viewerId],
	);

	const answerSql = useCallback(
		async (requestId: string, request: StorySqlRequest, fresh: boolean) => {
			hasReadViewerRowsRef.current = true;
			try {
				const result = await queryClient.fetchQuery({
					queryKey: ['custom-story-sql', dataSource, request],
					queryFn: () => runStorySql(dataSource, request),
					...(fresh && { staleTime: 0 }),
				});
				rememberRequestAnswer(viewerId, dataSource, storySqlRequestKey(request), result);
				reply({ type: 'nao-story:query-result', requestId, result });
			} catch (error) {
				reply({ type: 'nao-story:query-error', requestId, message: describeError(error) });
			}
		},
		[dataSource, queryClient, reply, viewerId],
	);

	const answerModels = useCallback(
		async (requestId: string) => {
			try {
				const models = await queryClient.fetchQuery(modelsOptions(dataSource));
				reply({ type: 'nao-story:models-result', requestId, models });
			} catch (error) {
				reply({ type: 'nao-story:models-error', requestId, message: describeError(error) });
			}
		},
		[dataSource, queryClient, reply],
	);

	/** Model answers are kept for the visit: a story rebuilt, re-themed or republished asks again without paying again. */
	const answerModel = useCallback(
		async (requestId: string, request: StoryModelRequest, fresh: boolean) => {
			try {
				const result = await queryClient.fetchQuery({
					queryKey: ['custom-story-model', withoutVersion(dataSource), request],
					queryFn: () => runStoryModel(dataSource, request),
					staleTime: fresh ? 0 : Infinity,
					gcTime: Infinity,
				});
				reply({ type: 'nao-story:model-result', requestId, result });
			} catch (error) {
				reply({ type: 'nao-story:model-error', requestId, message: describeError(error) });
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

	const answerChartPlugin = useCallback(
		async (requestId: string, chartType: string) => {
			try {
				const source = await fetchChartPluginSource(queryClient, dataSource, chartType);
				reply({ type: 'nao-story:chart-plugin-result', requestId, source });
			} catch (error) {
				reply({ type: 'nao-story:chart-plugin-error', requestId, message: describeError(error) });
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
					reply({ type: 'nao-story:inspector', enabled: isAskable, selectsElements: isSelectingElements });
					reply({ type: 'nao-story:shortcuts', shortcuts: getAppWideShortcuts() });
					syncThemeOnReady();
					forwardHighlight();
					onReady?.();
					break;
				case 'nao-story:query':
					void answerQuery(message.requestId, message.queryId, message.fresh === true, message.inputs);
					break;
				case 'nao-story:sql':
					void answerSql(
						message.requestId,
						{ sql: message.sql, databaseId: message.databaseId, filters: message.filters },
						message.fresh === true,
					);
					break;
				case 'nao-story:models':
					void answerModels(message.requestId);
					break;
				case 'nao-story:model':
					void answerModel(message.requestId, message.request, message.fresh === true);
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
				case 'nao-story:ask-block': {
					const ask = editable ? readBlockAsk(message.block) : null;
					if (ask) {
						onAsk?.({ ...ask, intent: 'edit' });
					}
					break;
				}
				case 'nao-story:ask': {
					const ask = isUserGesture() ? readStoryElementAsk(message) : null;
					if (ask) {
						onAsk?.({ ...ask, intent: 'ask' });
					}
					break;
				}
				case 'nao-story:query-sql':
					void answerQuerySql(message.requestId, message.queryId);
					break;
				case 'nao-story:chart-plugin':
					void answerChartPlugin(message.requestId, message.chartType);
					break;
				case 'nao-story:set-state':
					if (message.shared === true && hasReadViewerRowsRef.current) {
						onError?.({ message: SHARED_STATE_AFTER_VIEWER_ROWS_MESSAGE });
						break;
					}
					recordStateChange({ key: message.key, value: message.value, shared: message.shared === true });
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
		answerChartPlugin,
		answerModel,
		answerModels,
		answerNarratives,
		answerQuery,
		answerQuerySql,
		answerSql,
		channel,
		connectPort,
		dateFormat,
		editable,
		isAskable,
		isSelectingElements,
		onAsk,
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
			reply({ type: 'nao-story:inspector', enabled: isAskable, selectsElements: isSelectingElements });
		}
	}, [isAskable, isSelectingElements, reply]);

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
			hasReadViewerRowsRef.current = false;
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
			{!usesState && stateControls?.hasLocalState && onRememberState && (
				<RememberStateHeader onRemember={onRememberState} />
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
	const loadState = useEffectEvent(async (): Promise<StoryStateSnapshot> => {
		if (!usesState) {
			return EMPTY_STORY_STATE_SNAPSHOT;
		}
		const options = stateOptions(dataSource);
		return queryClient
			.fetchQuery(options)
			.catch(() => queryClient.getQueryData(options.queryKey) ?? EMPTY_STORY_STATE_SNAPSHOT);
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

/** A model's answer depends on the request, not on which version of the story asked. */
function withoutVersion(dataSource: CustomStoryDataSource): Omit<CustomStoryDataSource, 'versionNumber'> {
	const { versionNumber: _versionNumber, ...identity } = dataSource as CustomStoryDataSource & {
		versionNumber?: number;
	};
	return identity;
}

function storySlugOf(dataSource: CustomStoryDataSource): string | undefined {
	return 'storySlug' in dataSource ? dataSource.storySlug : undefined;
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
