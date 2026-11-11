import { observable } from '@trpc/server/observable';
import { describe, expect, it, vi } from 'vitest';

import { createForbiddenResponseLink } from './forbidden-response-link';

describe('createForbiddenResponseLink', () => {
	it('notifies forbidden responses after passing the error on', async () => {
		const onForbidden = vi.fn();
		const onError = vi.fn();

		failRequestWith(onForbidden, 'FORBIDDEN', onError);
		await Promise.resolve();

		expect(onError).toHaveBeenCalled();
		expect(onForbidden).toHaveBeenCalledTimes(1);
	});

	it('ignores other errors', async () => {
		const onForbidden = vi.fn();

		failRequestWith(onForbidden, 'UNAUTHORIZED', vi.fn());
		await Promise.resolve();

		expect(onForbidden).not.toHaveBeenCalled();
	});
});

function failRequestWith(onForbidden: () => void, code: string, onError: () => void) {
	const link = createForbiddenResponseLink(onForbidden)({} as never);
	const failingNext = () => {
		return observable((observer) => {
			observer.error({ data: { code } } as never);
		});
	};
	link({ op: { id: 1, path: 'chat.list', type: 'query' } as never, next: failingNext as never }).subscribe({
		error: onError,
	});
}
