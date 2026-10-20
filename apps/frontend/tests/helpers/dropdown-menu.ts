import { fireEvent, screen } from '@testing-library/react';

/** Radix dropdown triggers open on a primary-button pointerdown, not on click. */
export function openDropdownMenu(trigger: HTMLElement | string | RegExp) {
	const element = trigger instanceof HTMLElement ? trigger : screen.getByRole('button', { name: trigger });
	fireEvent.pointerDown(element, { button: 0, ctrlKey: false });
}
