import { isStoryFrameMessage, STORY_RUNTIME_PATH } from '@nao/shared/story-app';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { buildStoryFrameDocument } from './story-frame-document';
import type { StoryBlockEditPayload, StoryFrameMessage, StoryHostMessage } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { StoryRuntimeLocation } from './story-frame-document';
import { useDateFormat } from '@/hooks/use-date-format';
import { downloadCsv, downloadXlsx, tableToCsv, tableToTsv } from '@/lib/table-export';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { chatActivityStore } from '@/stores/chat-activity';

export interface CustomStoryRuntimeError {
	message: string;
	stack?: string;
}

const QUERY_RETRY_DELAY_MS = 1500;
const MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING = 10;
const MAX_EXPORT_FILENAME_LENGTH = 100;

interface CustomStoryFrameProps {
	chatId: string;
	bundle: string;
	styles: string[];
	theme: StoryTheme;
	editable?: boolean;
	onEditBlock?: (request: StoryBlockEditPayload) => void;
	onReady?: () => void;
	onError?: (error: CustomStoryRuntimeError) => void;
	className?: string;
}

const NAVIGATED_AWAY_MESSAGE = 'The story tried to navigate away from its frame and was stopped.';

export function CustomStoryFrame({
	chatId,
	bundle,
	styles,
	theme,
	editable = false,
	onEditBlock,
	onReady,
	onError,
	className,
}: CustomStoryFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const loadCountRef = useRef(0);
	const isFrameReadyRef = useRef(false);
	const [navigatedAway, setNavigatedAway] = useState(false);
	const queryClient = useQueryClient();
	const dateFormat = useDateFormat();
	const srcDoc = useStoryFrameDocument(bundle, styles, theme, onError);

	const reply = useCallback((message: StoryHostMessage) => {
		iframeRef.current?.contentWindow?.postMessage(message, '*');
	}, []);

	const answerQuery = useCallback(
		async (requestId: string, queryId: string) => {
			try {
				const result = await queryClient.fetchQuery({
					...trpc.story.getCustomStoryQueryData.queryOptions({ chatId, queryId }),
					retry: (failureCount) =>
						failureCount < MAX_QUERY_RETRIES_WHILE_CHAT_RUNNING &&
						chatActivityStore.getActivity(chatId).running,
					retryDelay: QUERY_RETRY_DELAY_MS,
				});
				reply({ type: 'nao-story:query-result', requestId, result });
			} catch (error) {
				reply({ type: 'nao-story:query-error', requestId, message: describeError(error) });
			}
		},
		[chatId, queryClient, reply],
	);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<unknown>) => {
			if (event.source !== iframeRef.current?.contentWindow || !isStoryFrameMessage(event.data)) {
				return;
			}
			dispatch(event.data);
		};
		const dispatch = (message: StoryFrameMessage) => {
			switch (message.type) {
				case 'nao-story:ready':
					isFrameReadyRef.current = true;
					reply({ type: 'nao-story:editing', enabled: editable });
					onReady?.();
					break;
				case 'nao-story:query':
					void answerQuery(message.requestId, message.queryId);
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
			}
		};
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [answerQuery, dateFormat, editable, onEditBlock, onError, onReady, reply]);

	useEffect(() => {
		if (isFrameReadyRef.current) {
			reply({ type: 'nao-story:editing', enabled: editable });
		}
	}, [editable, reply]);

	const handleLoad = useCallback(() => {
		loadCountRef.current += 1;
		if (loadCountRef.current > 1) {
			setNavigatedAway(true);
			onError?.({ message: NAVIGATED_AWAY_MESSAGE });
		}
	}, [onError]);

	useEffect(() => {
		if (srcDoc !== null) {
			loadCountRef.current = 0;
			isFrameReadyRef.current = false;
			setNavigatedAway(false);
		}
	}, [srcDoc]);

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
): string | null {
	const [srcDoc, setSrcDoc] = useState<string | null>(null);
	const reportError = useEffectEvent((error: unknown) => onError?.({ message: describeError(error) }));
	useEffect(() => {
		let cancelled = false;
		setSrcDoc(null);
		buildStoryFrameDocument({ bundle, styles, theme, runtime: storyRuntimeLocation() }).then(
			(html) => {
				if (!cancelled) {
					setSrcDoc(html);
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
	return srcDoc;
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
