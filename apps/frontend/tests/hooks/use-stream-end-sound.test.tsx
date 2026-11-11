// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { soundNotificationStorage, useStreamEndSound } from '@/hooks/use-stream-end-sound';

const chatIdState = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock('@/hooks/use-chat-id', () => ({
	useChatId: () => chatIdState.current,
}));

const createAudioContextMock = () => {
	const audioNode = { connect: vi.fn() };
	const gainParam = {
		setValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		exponentialRampToValueAtTime: vi.fn(),
	};
	return vi.fn(function () {
		return {
			currentTime: 0,
			destination: {},
			createOscillator: () => ({
				...audioNode,
				frequency: { value: 0 },
				type: 'sine',
				start: vi.fn(),
				stop: vi.fn(),
			}),
			createGain: () => ({ ...audioNode, gain: gainParam }),
			close: vi.fn(),
		};
	});
};

describe('useStreamEndSound', () => {
	let audioContextMock: ReturnType<typeof createAudioContextMock>;

	beforeEach(() => {
		localStorage.clear();
		chatIdState.current = undefined;
		audioContextMock = createAudioContextMock();
		vi.stubGlobal('AudioContext', audioContextMock);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('plays a sound when a new chat finishes after receiving its id mid-stream', () => {
		const { update } = renderSound(false, undefined);

		update(true, undefined);
		update(true, 'chat-1');
		update(false, 'chat-1');

		expect(audioContextMock).toHaveBeenCalledTimes(1);
	});

	it('plays a sound each time an already-open chat finishes', () => {
		const { update } = renderSound(false, 'chat-1');

		update(true, 'chat-1');
		update(false, 'chat-1');
		update(true, 'chat-1');
		update(false, 'chat-1');

		expect(audioContextMock).toHaveBeenCalledTimes(2);
	});

	it('plays a sound in a chat opened from another chat', () => {
		const { update } = renderSound(false, 'chat-1');

		update(false, 'chat-2');
		update(true, 'chat-2');
		update(false, 'chat-2');

		expect(audioContextMock).toHaveBeenCalledTimes(1);
	});

	it('stays silent when switching away from a running chat to an idle one', () => {
		const { update } = renderSound(true, 'chat-1');

		update(false, 'chat-2');

		expect(audioContextMock).not.toHaveBeenCalled();
	});

	it('stays silent while the chat is still running', () => {
		const { update } = renderSound(false, 'chat-1');

		update(true, 'chat-1');
		update(true, 'chat-1');

		expect(audioContextMock).not.toHaveBeenCalled();
	});

	it('keeps the hook silent during StrictMode mount double-effects and plays once on completion', () => {
		const { update } = renderSound(false, 'chat-1', StrictMode);

		update(true, 'chat-1');
		update(false, 'chat-1');

		expect(audioContextMock).toHaveBeenCalledTimes(1);
	});

	it('stays silent when the sound notification is disabled', () => {
		soundNotificationStorage.set(false);
		const { update } = renderSound(false, 'chat-1');

		update(true, 'chat-1');
		update(false, 'chat-1');

		expect(audioContextMock).not.toHaveBeenCalled();
	});
});

function renderSound(isRunning: boolean, chatId: string | undefined, wrapper?: ComponentType<{ children: ReactNode }>) {
	chatIdState.current = chatId;
	const hook = renderHook(({ running }: { running: boolean }) => useStreamEndSound(running), {
		initialProps: { running: isRunning },
		wrapper,
	});
	const update = (nextIsRunning: boolean, nextChatId: string | undefined) => {
		chatIdState.current = nextChatId;
		hook.rerender({ running: nextIsRunning });
	};
	return { ...hook, update };
}
