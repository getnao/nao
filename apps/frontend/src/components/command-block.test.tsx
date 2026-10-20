// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandBlock } from './command-block';

const writeText = vi.fn();

beforeEach(() => {
	writeText.mockReset();
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
});

afterEach(cleanup);

describe('CommandBlock', () => {
	it('reports clipboard failures without rejecting the click handler', async () => {
		writeText.mockRejectedValue(new Error('Clipboard permission denied'));
		render(<CommandBlock command='nao init' />);

		fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));

		expect((await screen.findByRole('status')).textContent).toBe('Command was not copied');
		expect(screen.getByRole('button', { name: 'Copy failed' })).toBeTruthy();
	});
});
