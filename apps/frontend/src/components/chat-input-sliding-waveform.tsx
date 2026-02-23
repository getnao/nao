import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const SAMPLE_INTERVAL_MS = 50;
const BAR_WIDTH = 2.5;
const BAR_GAP = 1.5;
const BAR_MIN_H = 1.5;

export function SlidingWaveform({ analyserRef }: { analyserRef: RefObject<AnalyserNode | null> }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const historyRef = useRef<number[]>([]);
	const animFrameRef = useRef<number>(0);
	const lastSampleRef = useRef<number>(0);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		const resizeCanvas = () => {
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
		};
		resizeCanvas();
		const observer = new ResizeObserver(resizeCanvas);
		observer.observe(canvas);

		const ctx = canvas.getContext('2d')!;
		const timeDomainBuf = new Float32Array(256);

		const maxBars = () => Math.floor(canvas.width / ((BAR_WIDTH + BAR_GAP) * dpr)) + 1;

		const draw = (now: number) => {
			const analyser = analyserRef.current;

			if (analyser && now - lastSampleRef.current >= SAMPLE_INTERVAL_MS) {
				lastSampleRef.current = now;
				analyser.getFloatTimeDomainData(timeDomainBuf);

				let sum = 0;
				for (const sample of timeDomainBuf) {
					sum += sample * sample;
				}
				const rms = Math.sqrt(sum / timeDomainBuf.length);
				const normalized = Math.min(1, Math.sqrt(rms / 0.15));

				historyRef.current.push(normalized);
				const max = maxBars();
				if (historyRef.current.length > max) {
					historyRef.current = historyRef.current.slice(-max);
				}
			}

			const { width, height } = canvas;
			ctx.clearRect(0, 0, width, height);

			const history = historyRef.current;
			const barW = BAR_WIDTH * dpr;
			const gap = BAR_GAP * dpr;
			const step = barW + gap;
			const midY = height / 2;
			const minH = BAR_MIN_H * dpr;

			const startX = width - history.length * step;

			for (let i = 0; i < history.length; i++) {
				const value = history[i];
				const barH = Math.max(minH, value * height * 0.85);
				const x = startX + i * step;

				ctx.beginPath();
				ctx.roundRect(x, midY - barH / 2, barW, barH, barW / 2);
				ctx.fillStyle = `hsl(var(--primary) / ${0.25 + value * 0.75})`;
				ctx.fill();
			}

			animFrameRef.current = requestAnimationFrame(draw);
		};

		animFrameRef.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(animFrameRef.current);
			observer.disconnect();
		};
	}, [analyserRef]);

	return <canvas ref={canvasRef} className='flex-1 h-7 min-w-0' />;
}
