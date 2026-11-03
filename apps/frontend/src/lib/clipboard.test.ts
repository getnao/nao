// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyDeferredTextToClipboard, copyTextToClipboard } from './clipboard';

const execCommand = vi.fn<(command: string) => boolean>();
let copiedWithSelection: string[] = [];

beforeEach(() => {
	copiedWithSelection = [];
	execCommand.mockReset();
	execCommand.mockImplementation(() => {
		const textarea = document.querySelector('textarea');
		const isSelected =
			!!textarea && document.activeElement === textarea && textarea.selectionEnd === textarea.value.length;
		copiedWithSelection.push(isSelected ? textarea.value : '');
		return true;
	});
	Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
});

afterEach(() => {
	setClipboard(undefined);
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('copyTextToClipboard', () => {
	it('uses the async Clipboard API when available', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });

		await copyTextToClipboard('hello');

		expect(writeText).toHaveBeenCalledWith('hello');
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('falls back to a selection copy when the Clipboard API is missing', async () => {
		await copyTextToClipboard('hello');

		expect(copiedWithSelection).toEqual(['hello']);
		expectNoLeftoverTextarea();
	});

	it('falls back to a selection copy when the Clipboard API rejects', async () => {
		setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });

		await copyTextToClipboard('hello');

		expect(copiedWithSelection).toEqual(['hello']);
		expectNoLeftoverTextarea();
	});

	it('rejects and cleans up when the selection copy fails', async () => {
		execCommand.mockReturnValue(false);
		const button = focusNewButton(document.body);

		await expect(copyTextToClipboard('hello')).rejects.toThrow();

		expectNoLeftoverTextarea();
		expect(document.activeElement).toBe(button);
	});

	it('copies from inside the open dialog and restores focus', async () => {
		const dialog = document.createElement('div');
		dialog.setAttribute('role', 'dialog');
		document.body.appendChild(dialog);
		const button = focusNewButton(dialog);
		let textareaParent: Element | null = null;
		execCommand.mockImplementation(() => {
			textareaParent = document.querySelector('textarea')?.parentElement ?? null;
			return true;
		});

		await copyTextToClipboard('hello');

		expect(execCommand).toHaveBeenCalledWith('copy');
		expect(textareaParent).toBe(dialog);
		expectNoLeftoverTextarea();
		expect(document.activeElement).toBe(button);
	});
});

describe('copyDeferredTextToClipboard', () => {
	it('writes a ClipboardItem when supported', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		setClipboard({ write });
		vi.stubGlobal(
			'ClipboardItem',
			class {
				constructor(public items: Record<string, Promise<Blob>>) {}
			},
		);

		await copyDeferredTextToClipboard(Promise.resolve('https://nao.test/share'));

		expect(write).toHaveBeenCalledOnce();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('falls back to a selection copy once the text resolves when ClipboardItem is missing', async () => {
		await copyDeferredTextToClipboard(Promise.resolve('https://nao.test/share'));

		expect(copiedWithSelection).toEqual(['https://nao.test/share']);
	});

	it('rejects when the text cannot be resolved', async () => {
		await expect(copyDeferredTextToClipboard(Promise.reject(new Error('share failed')))).rejects.toThrow(
			'share failed',
		);
		expect(execCommand).not.toHaveBeenCalled();
	});
});

function setClipboard(clipboard: Partial<Clipboard> | undefined) {
	Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function focusNewButton(container: Element) {
	const button = document.createElement('button');
	container.appendChild(button);
	button.focus();
	return button;
}

function expectNoLeftoverTextarea() {
	expect(document.querySelector('textarea')).toBeNull();
}
