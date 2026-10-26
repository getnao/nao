// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useCopyToClipboard } from './use-copy-to-clipboard';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
	restoreProperty(navigator, 'clipboard', clipboardDescriptor);
	restoreProperty(document, 'execCommand', execCommandDescriptor);
	vi.restoreAllMocks();
});

it('falls back to copying through a textarea when the Clipboard API fails', async () => {
	const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));
	const execCommand = vi.fn().mockReturnValue(true);
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
	Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
	const { result } = renderHook(() => useCopyToClipboard());

	await act(() => result.current.copy('Error details'));

	expect(writeText).toHaveBeenCalledWith('Error details');
	expect(execCommand).toHaveBeenCalledWith('copy');
	expect(result.current.isCopied).toBe(true);
	expect(document.querySelector('textarea')).toBeNull();
});

function restoreProperty(target: object, property: string, descriptor: PropertyDescriptor | undefined) {
	if (descriptor) {
		Object.defineProperty(target, property, descriptor);
	} else {
		Reflect.deleteProperty(target, property);
	}
}
