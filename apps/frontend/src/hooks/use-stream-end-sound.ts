import { useEffect, useRef } from 'react';
import { useChatId } from './use-chat-id';
import { createLocalStorage } from '@/lib/local-storage';

export const soundNotificationStorage = createLocalStorage<boolean>('sound-notification-enabled', true);

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
	const chatId = useChatId();
	const previousStateRef = useRef({ isRunning, chatId });

	useEffect(() => {
		const previous = previousStateRef.current;
		previousStateRef.current = { isRunning, chatId };

		const streamEnded = previous.isRunning && !isRunning;
		const sameChat = previous.chatId === chatId;
		if (streamEnded && sameChat && soundNotificationStorage.get()) {
			playNotificationSound();
		}
	}, [isRunning, chatId]);
};
