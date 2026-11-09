// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOnAskRequest } from './use-on-ask-request';

import { requestAsk } from '@/stores/ask-bar';

describe('useOnAskRequest', () => {
	it('runs once for each question asked after the page mounted', () => {
		act(() => requestAsk());
		const onRequest = vi.fn();
		const { rerender } = renderHook(() => useOnAskRequest(onRequest));
		expect(onRequest).not.toHaveBeenCalled();

		act(() => requestAsk());
		rerender();

		expect(onRequest).toHaveBeenCalledTimes(1);
	});
});
