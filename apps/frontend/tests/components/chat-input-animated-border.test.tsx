// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatInputAnimatedBorder } from '@/components/chat-input-animated-border';

const BAR_SIZE = { width: 400, height: 100 };

describe('ChatInputAnimatedBorder', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it.each([
		{ from: '9999px', to: '16px', expectedRadius: '16' },
		{ from: '16px', to: '9999px', expectedRadius: '50' },
	])('follows the bar when its corners change from $from to $to', async ({ from, to, expectedRadius }) => {
		stubResizeObserverWithSize(BAR_SIZE);
		const { container } = render(
			<div style={{ borderTopLeftRadius: from }}>
				<ChatInputAnimatedBorder isStatic />
			</div>,
		);
		const bar = container.firstElementChild as HTMLElement;

		await act(async () => {
			bar.style.borderTopLeftRadius = to;
		});

		expect(container.querySelector('rect')?.getAttribute('rx')).toBe(expectedRadius);
	});
});

function stubResizeObserverWithSize(size: { width: number; height: number }) {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(private readonly callback: ResizeObserverCallback) {}
			observe() {
				this.callback([{ contentRect: size } as ResizeObserverEntry], this as unknown as ResizeObserver);
			}
			disconnect() {}
		},
	);
}
