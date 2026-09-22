import { isStoryFrameMessage, STORY_RUNTIME_PATH } from '@nao/shared/story-app';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildStoryFrameDocument } from './story-frame-document';
import type { StoryFrameMessage, StoryHostMessage } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { StoryRuntimeLocation } from './story-frame-document';

import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export interface CustomStoryRuntimeError {
	message: string;
	stack?: string;
}

interface CustomStoryFrameProps {
	chatId: string;
	bundle: string;
	styles: string[];
	theme: StoryTheme;
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
	onReady,
	onError,
	className,
}: CustomStoryFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const loadCountRef = useRef(0);
	const [navigatedAway, setNavigatedAway] = useState(false);
	const queryClient = useQueryClient();
	const srcDoc = useStoryFrameDocument(bundle, styles, theme, onError);

	const reply = useCallback((message: StoryHostMessage) => {
		iframeRef.current?.contentWindow?.postMessage(message, '*');
	}, []);

	const answerQuery = useCallback(
		async (requestId: string, queryId: string) => {
			try {
				const result = await queryClient.fetchQuery(
					trpc.story.getCustomStoryQueryData.queryOptions({ chatId, queryId }),
				);
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
					onReady?.();
					break;
				case 'nao-story:query':
					void answerQuery(message.requestId, message.queryId);
					break;
				case 'nao-story:error':
					onError?.({ message: message.message, stack: message.stack });
					break;
			}
		};
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [answerQuery, onError, onReady]);

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
			title='Custom story'
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
					onError?.({ message: describeError(error) });
				}
			},
		);
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- onError intentionally excluded from the deps: rebuilding the document on every render where the caller passes a new inline `onError` would defeat the point of this effect. Safe today because the only caller memoizes it with an empty dependency array.
	}, [bundle, styles, theme]);
	return srcDoc;
}

function storyRuntimeLocation(): StoryRuntimeLocation {
	const origin = window.location.origin;
	return import.meta.env.DEV
		? { baseUrl: `${origin}/src/story-runtime/`, extension: '.ts' }
		: { baseUrl: `${origin}${STORY_RUNTIME_PATH}/`, extension: '.js' };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : 'The query could not be loaded.';
}
