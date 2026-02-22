import { useState, useRef, useCallback, useEffect } from 'react';

import { trpcClient } from '@/main';

type TranscribeState = 'idle' | 'recording' | 'transcribing';

export function useTranscribe(onTranscribed: (text: string) => void) {
	const [state, setState] = useState<TranscribeState>('idle');
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const onTranscribedRef = useRef(onTranscribed);
	useEffect(() => {
		onTranscribedRef.current = onTranscribed;
	});

	const stop = useCallback(() => {
		if (mediaRecorderRef.current?.state === 'recording') {
			mediaRecorderRef.current.stop();
		}
	}, []);

	useEffect(() => {
		if (state !== 'recording') {
			return;
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				stop();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [state, stop]);

	const start = useCallback(async () => {
		if (state !== 'idle') {
			return;
		}

		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

		const audioCtx = new AudioContext();
		const source = audioCtx.createMediaStreamSource(stream);
		const analyser = audioCtx.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.4;
		source.connect(analyser);
		audioCtxRef.current = audioCtx;
		analyserRef.current = analyser;

		const mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
		mediaRecorderRef.current = mediaRecorder;
		chunksRef.current = [];

		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				chunksRef.current.push(e.data);
			}
		};

		mediaRecorder.onstop = async () => {
			stream.getTracks().forEach((t) => t.stop());
			audioCtxRef.current?.close();
			audioCtxRef.current = null;
			analyserRef.current = null;

			const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
			if (blob.size === 0) {
				setState('idle');
				return;
			}

			setState('transcribing');

			try {
				const base64 = await blobToBase64(blob);
				const { text } = await trpcClient.transcribe.transcribe.mutate({ audio: base64 });
				if (text?.trim()) {
					onTranscribedRef.current(text.trim());
				}
			} catch (err) {
				console.error('Transcription error:', err);
			} finally {
				setState('idle');
			}
		};

		mediaRecorder.start();
		setState('recording');
	}, [state]);

	const toggle = useCallback(() => {
		if (state === 'recording') {
			stop();
		} else if (state === 'idle') {
			start();
		}
	}, [state, start, stop]);

	return {
		state,
		toggle,
		isRecording: state === 'recording',
		isTranscribing: state === 'transcribing',
		analyserRef,
	};
}

function getSupportedMimeType(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
	return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const dataUrl = reader.result as string;
			resolve(dataUrl.split(',')[1]);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
