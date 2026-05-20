import { useCallback, useEffect, useRef, useState } from 'react';

import { createMicPcm16Stream } from '@/lib/pcm16-audio';
import { trpcClient } from '@/main';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

type RealtimeServerEvent = {
	type?: string;
	transcript?: string;
	error?: { message?: string };
};

export function useLiveVoice({
	active,
	paused,
	onUtterance,
}: {
	active: boolean;
	paused: boolean;
	onUtterance: (text: string) => void | Promise<void>;
}) {
	const [status, setStatus] = useState<LiveVoiceStatus>('idle');
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const micRef = useRef<{ stop: () => void } | null>(null);
	const onUtteranceRef = useRef(onUtterance);
	const pausedRef = useRef(paused);
	const lastTranscriptRef = useRef('');
	const handlingUtteranceRef = useRef(false);

	useEffect(() => {
		onUtteranceRef.current = onUtterance;
	});

	useEffect(() => {
		pausedRef.current = paused;
	});

	const teardown = useCallback(() => {
		wsRef.current?.close();
		wsRef.current = null;
		micRef.current?.stop();
		micRef.current = null;
		analyserRef.current = null;
		lastTranscriptRef.current = '';
		handlingUtteranceRef.current = false;
	}, []);

	useEffect(() => {
		if (!active) {
			teardown();
			setStatus('idle');
			setErrorMessage(null);
			return;
		}

		let cancelled = false;

		const connect = async () => {
			setStatus('connecting');
			setErrorMessage(null);

			try {
				const session = await trpcClient.transcribe.createLiveSession.mutate();
				if (cancelled) {
					return;
				}

				const ws = new WebSocket(REALTIME_URL, ['realtime', `openai-insecure-api-key.${session.clientSecret}`]);
				wsRef.current = ws;

				ws.onopen = () => {
					if (cancelled) {
						ws.close();
						return;
					}
					setStatus('listening');
				};

				ws.onmessage = (event) => {
					let payload: RealtimeServerEvent;
					try {
						payload = JSON.parse(event.data as string) as RealtimeServerEvent;
					} catch {
						return;
					}

					if (payload.type === 'error') {
						setErrorMessage(payload.error?.message ?? 'Live voice connection error');
						setStatus('error');
						return;
					}

					if (payload.type === 'input_audio_buffer.speech_started') {
						lastTranscriptRef.current = '';
						return;
					}

					if (payload.type !== 'conversation.item.input_audio_transcription.completed') {
						return;
					}

					const transcript = payload.transcript?.trim() ?? '';
					if (!transcript || transcript === lastTranscriptRef.current || handlingUtteranceRef.current) {
						return;
					}

					lastTranscriptRef.current = transcript;
					handlingUtteranceRef.current = true;
					void Promise.resolve(onUtteranceRef.current(transcript)).finally(() => {
						handlingUtteranceRef.current = false;
					});
				};

				ws.onerror = () => {
					if (!cancelled) {
						setErrorMessage('Live voice connection failed');
						setStatus('error');
					}
				};

				ws.onclose = () => {
					if (!cancelled && wsRef.current === ws) {
						setStatus('error');
						setErrorMessage((prev) => prev ?? 'Live voice connection closed');
					}
				};

				const mic = createMicPcm16Stream((audio) => {
					if (cancelled || pausedRef.current || ws.readyState !== WebSocket.OPEN) {
						return;
					}
					ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
				});
				micRef.current = mic;
				analyserRef.current = mic.analyser;
			} catch (err) {
				if (!cancelled) {
					setErrorMessage(err instanceof Error ? err.message : 'Failed to start live voice');
					setStatus('error');
				}
			}
		};

		void connect();

		return () => {
			cancelled = true;
			teardown();
		};
	}, [active, teardown]);

	return {
		status,
		errorMessage,
		analyserRef,
		isListening: status === 'listening' && !paused,
	};
}
