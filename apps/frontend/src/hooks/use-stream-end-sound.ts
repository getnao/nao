import { useEffect } from 'react';
import { usePrevRef } from './use-prev';

const playNotificationSound = () => {
	const ctx = new AudioContext();
	const now = ctx.currentTime;

	const playTone = (frequency: number, startTime: number, duration: number) => {
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();

		oscillator.connect(gain);
		gain.connect(ctx.destination);

		oscillator.type = 'sine';
		oscillator.frequency.value = frequency;

		gain.gain.setValueAtTime(0, startTime);
		gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

		oscillator.start(startTime);
		oscillator.stop(startTime + duration);
	};

	playTone(587, now, 0.15);
	playTone(880, now + 0.1, 0.2);

	setTimeout(() => ctx.close(), 500);
};

export const useStreamEndSound = (isRunning: boolean) => {
	const prevIsRunningRef = usePrevRef(isRunning);

	useEffect(() => {
		if (prevIsRunningRef.current && !isRunning) {
			playNotificationSound();
		}
	}, [isRunning, prevIsRunningRef]);
};
