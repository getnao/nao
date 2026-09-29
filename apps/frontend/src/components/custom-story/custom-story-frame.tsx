import {
	isFromStoryChannel,
	isStoryFrameMessage,
	STORY_CONNECT_MESSAGE,
	STORY_RUNTIME_PATH,
} from '@nao/shared/story-app';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { narrativesOptions, queryDataOptions, querySqlOptions } from './story-data-options';
import { buildStoryFrameDocument } from './story-frame-document';
import type {
	StoryBlockEditPayload,
	StoryFrameMessage,
	StoryHostMessage,
	StoryTableFormatEditRequest,
} from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { StoryBlockReference } from '@nao/shared/types';

import type { CustomStoryDataSource } from './story-data-options';
import type { StoryRuntimeLocation } from './story-frame-document';
import { useDateFormat } from '@/hooks/use-date-format';
import { downloadCsv, downloadXlsx, tableToCsv, tableToTsv } from '@/lib/table-export';
import { cn } from '@/lib/utils';

export interface CustomStoryRuntimeError {
	message: string;
	stack?: string;
}

const MAX_EXPORT_FILENAME_LENGTH = 100;

interface CustomStoryFrameProps {
	dataSource: CustomStoryDataSource;
	bundle: string;
	styles: string[];
	theme: StoryTheme;
	editable?: boolean;
	onEditBlock?: (request: StoryBlockEditPayload) => void;
	onEditTableFormat?: (request: StoryTableFormatEditRequest) => void;
	onAskBlock?: (block: StoryBlockReference) => void;
	onReady?: () => void;
	onError?: (error: CustomStoryRuntimeError) => void;
	className?: string;
}

const NAVIGATED_AWAY_MESSAGE = 'The story tried to navigate away from its frame and was stopped.';

export function CustomStoryFrame({
	dataSource,
	bundle,
	styles,
	theme,
	editable = false,
	onEditBlock,
	onEditTableFormat,
	onAskBlock,
	onReady,
	onError,
	className,
}: CustomStoryFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const loadCountRef = useRef(0);
	const isFrameReadyRef = useRef(false);
	const portRef = useRef<MessagePort | null>(null);
	const [navigatedAway, setNavigatedAway] = useState(false);
	const queryClient = useQueryClient();
	const dateFormat = useDateFormat();
	const frameDocument = useStoryFrameDocument(bundle, styles, theme, onError);
	const srcDoc = frameDocument?.html ?? null;
	const channel = frameDocument?.channel;

	const reply = useCallback((message: StoryHostMessage) => {
		portRef.current?.postMessage(message);
	}, []);

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
		reply,
	]);

	useEffect(() => {
		if (isFrameReadyRef.current) {
			reply({ type: 'nao-story:editing', enabled: editable });
		}
	}, [editable, reply]);

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
		<iframe
			ref={iframeRef}
			aria-label='Custom story'
			sandbox='allow-scripts'
			referrerPolicy='no-referrer'
			srcDoc={srcDoc}
			onLoad={handleLoad}
			className={cn('block h-full w-full border-0 bg-transparent', className)}
		/>
	);
}

function useStoryFrameDocument(
	bundle: string,
	styles: string[],
	theme: StoryTheme,
	onError?: (error: CustomStoryRuntimeError) => void,
): { html: string; channel: string } | null {
	const [frameDocument, setFrameDocument] = useState<{ html: string; channel: string } | null>(null);
	const reportError = useEffectEvent((error: unknown) => onError?.({ message: describeError(error) }));
	useEffect(() => {
		let cancelled = false;
		setFrameDocument(null);
		const channel = crypto.randomUUID();
		buildStoryFrameDocument({ bundle, styles, theme, runtime: storyRuntimeLocation(), channel }).then(
			(html) => {
				if (!cancelled) {
					setFrameDocument({ html, channel });
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
	}, [bundle, styles, theme]);
	return frameDocument;
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
