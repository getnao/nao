// @vitest-environment jsdom

import { STORY_QUERY_ACCESS_DENIED_MESSAGE } from '@nao/shared/story-app';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlockState } from './block';

afterEach(cleanup);

describe('BlockState', () => {
	it('shows access denial as an unavailable placeholder instead of a broken block', () => {
		render(
			<BlockState
				data={{
					status: 'error',
					rows: null,
					columns: null,
					error: STORY_QUERY_ACCESS_DENIED_MESSAGE,
					refetch: vi.fn(),
				}}
			>
				{() => null}
			</BlockState>,
		);

		expect(screen.getByText('Data unavailable with your current access.')).toBeDefined();
		expect(document.querySelector('.nao-block__state--error')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});
});
