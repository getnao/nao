// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useStructurallyShared } from '@/hooks/use-structurally-shared';

describe('useStructurallyShared', () => {
	it('reuses the previous value when the new one is deep-equal', () => {
		const { result, rerender } = renderHook(({ value }) => useStructurallyShared(value), {
			initialProps: { value: { orders: { rows: [{ id: 1 }] } } },
		});
		const first = result.current;

		rerender({ value: { orders: { rows: [{ id: 1 }] } } });

		expect(result.current).toBe(first);
	});

	it('reuses unchanged nested objects when another key changes', () => {
		const { result, rerender } = renderHook(({ value }) => useStructurallyShared(value), {
			initialProps: { value: { orders: { rows: [{ id: 1 }] }, users: { rows: [{ id: 2 }] } } },
		});
		const first = result.current;

		rerender({ value: { orders: { rows: [{ id: 1 }] }, users: { rows: [{ id: 3 }] } } });

		expect(result.current).not.toBe(first);
		expect(result.current.orders).toBe(first.orders);
		expect(result.current.users).toEqual({ rows: [{ id: 3 }] });
	});
});
