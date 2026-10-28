// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { removeCitationPills } from './citation-mention';

describe('removing citation pills from a prompt', () => {
	it('takes the space after each pill along, and empties a prompt left blank', () => {
		const container = prompt('<span data-mention="Orders" data-mention-trigger="❝">Orders</span> ');

		removeCitationPills(container);

		expect(container.querySelector('.prompt-input')!.innerHTML).toBe('');
	});

	it('keeps what the user wrote around the pills', () => {
		const container = prompt('why <span data-mention="Orders" data-mention-trigger="❝">Orders</span> so low');

		removeCitationPills(container);

		expect(container.querySelector('.prompt-input')!.textContent).toBe('why so low');
	});
});

function prompt(html: string): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = `<div class="prompt-input">${html}</div>`;
	return container;
}
