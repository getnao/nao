// @vitest-environment jsdom

import { STORY_PRINT_CANVAS_ATTRIBUTE } from '@nao/shared/story-app';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Canvas } from '@/story-runtime/story-kit/canvas';

const host = vi.hoisted(() => ({ print: false }));
vi.mock('@/story-runtime/story-host', () => ({ isPrintMode: () => host.print }));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		disconnect() {}
	},
);

afterEach(() => {
	cleanup();
	host.print = false;
});

describe('Canvas', () => {
	it('prints at its own size and flags that size for the PDF page', () => {
		host.print = true;

		render(
			<Canvas width={800} height={1200}>
				<p>Poster</p>
			</Canvas>,
		);

		const surface = screen.getByText('Poster').parentElement!;
		expect(surface.style.width).toBe('800px');
		expect(surface.style.height).toBe('1200px');
		expect(surface.closest('.nao-canvas--print')?.parentElement).toBe(document.body);
		expect(document.documentElement.getAttribute(STORY_PRINT_CANVAS_ATTRIBUTE)).toBe('800x1200');
	});
});
