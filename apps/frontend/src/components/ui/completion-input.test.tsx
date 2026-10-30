// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompletionInput } from './completion-input';
import type { CompletionOptions } from './completion-input';

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

const NAMES = ['orders', 'order_value', 'revenue'];

afterEach(() => {
	cleanup();
});

describe('CompletionInput', () => {
	it('suggests completions for the text at the cursor once typing starts', () => {
		render(<Harness />);

		type('or');

		expect(optionLabels()).toEqual(['orders', 'order_value']);
		expect(input().getAttribute('aria-expanded')).toBe('true');
	});

	it('accepts the active completion with the keyboard', () => {
		render(<Harness />);

		type('or');
		fireEvent.keyDown(input(), { key: 'ArrowDown' });
		fireEvent.keyDown(input(), { key: 'Enter' });

		expect(input().value).toBe('order_value');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('accepts a completion on click', () => {
		render(<Harness />);

		type('rev');
		fireEvent.click(screen.getByRole('option', { name: 'revenue' }));

		expect(input().value).toBe('revenue');
	});

	it('leaves Enter alone when nothing matches', () => {
		render(<Harness />);

		type('xyz');
		const enter = fireEvent.keyDown(input(), { key: 'Enter' });

		expect(enter).toBe(true);
		expect(input().value).toBe('xyz');
	});

	it('closes on Escape', () => {
		render(<Harness />);

		type('or');
		fireEvent.keyDown(input(), { key: 'Escape' });

		expect(screen.queryByRole('listbox')).toBeNull();
	});
});

function Harness() {
	const [value, setValue] = useState('');
	return <CompletionInput aria-label='Metric' value={value} onValueChange={setValue} getCompletions={completeName} />;
}

function completeName(value: string, cursor: number): CompletionOptions {
	const typed = value.slice(0, cursor);
	return {
		from: 0,
		to: value.length,
		items: NAMES.filter((name) => typed && name.startsWith(typed)).map((name) => ({
			label: name,
			insertText: name,
		})),
	};
}

function type(text: string) {
	fireEvent.focus(input());
	fireEvent.change(input(), { target: { value: text, selectionStart: text.length } });
}

function input(): HTMLInputElement {
	return screen.getByRole('combobox', { name: 'Metric' });
}

function optionLabels(): string[] {
	return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}
