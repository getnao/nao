// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeLinkClicks } from '@/story-runtime/story-links';

describe('routeLinkClicks', () => {
	const openUrl = vi.fn();
	let stopRouting: () => void;

	beforeEach(() => {
		document.body.innerHTML = `
			<a id="external" href="https://crm.example.com/accounts/42" target="_blank"><span>Acme</span></a>
			<a id="in-page" href="#details">Details</a>
			<a id="script" href="javascript:void(0)">Script</a>
			<a id="mail" href="mailto:someone@example.com">Mail</a>
			<a id="download" href="https://files.example.com/report.csv" download>Download</a>
			<button id="button">Not a link</button>`;
		stopRouting = routeLinkClicks(openUrl);
	});

	afterEach(() => {
		stopRouting();
		openUrl.mockReset();
		document.body.innerHTML = '';
	});

	it('asks the host to open a web link clicked anywhere inside it, instead of following it', () => {
		expect(wasLeftToBrowser('#external span')).toBe(false);
		expect(openUrl).toHaveBeenCalledWith('https://crm.example.com/accounts/42');
	});

	it.each(['#in-page', '#script', '#mail', '#download', '#button'])('leaves %s to the browser', (selector) => {
		expect(wasLeftToBrowser(selector)).toBe(true);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
		'leaves a modified click (%o) to the browser',
		(init) => {
			expect(wasLeftToBrowser('#external', init)).toBe(true);
			expect(openUrl).not.toHaveBeenCalled();
		},
	);

	it('leaves a link the story handles itself alone', () => {
		document.querySelector('#external')!.addEventListener('click', (event) => event.preventDefault());

		wasLeftToBrowser('#external');

		expect(openUrl).not.toHaveBeenCalled();
	});

	it('stops routing once stopped', () => {
		stopRouting();

		expect(wasLeftToBrowser('#external')).toBe(true);
		expect(openUrl).not.toHaveBeenCalled();
	});
});

/** Cancels the click once it has passed the router, so jsdom never tries to follow the link. */
function wasLeftToBrowser(selector: string, init: MouseEventInit = {}): boolean {
	let isLeftToBrowser = false;
	const settle = (event: Event) => {
		isLeftToBrowser = !event.defaultPrevented;
		event.preventDefault();
	};
	window.addEventListener('click', settle, { once: true });
	document
		.querySelector(selector)!
		.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
	window.removeEventListener('click', settle);
	return isLeftToBrowser;
}
