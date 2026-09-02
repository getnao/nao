import { describe, expect, it } from 'vitest';

import { shouldShowChatAccessError } from './chat-error-state';

const trpcError = (code: string): { data: { code: string } } => ({ data: { code } });

describe('chat access error state', () => {
	it('shows the full-page error when the initial load has no data', () => {
		expect(
			shouldShowChatAccessError({
				error: new Error('Failed to fetch'),
				isError: true,
				isLoadingError: true,
			}),
		).toBe(true);
	});

	it('keeps the chat visible when a background refresh fails', () => {
		expect(
			shouldShowChatAccessError({
				error: new Error('Failed to fetch'),
				isError: true,
				isLoadingError: false,
			}),
		).toBe(false);
	});

	it.each(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'])(
		'hides cached chat data after the definitive %s error',
		(code) => {
			expect(
				shouldShowChatAccessError({
					error: trpcError(code),
					isError: true,
					isLoadingError: false,
				}),
			).toBe(true);
		},
	);
});
