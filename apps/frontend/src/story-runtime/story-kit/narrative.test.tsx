// @vitest-environment jsdom

import { STORY_NARRATIVES_REDACT_MISSING_KEY } from '@nao/shared/story-app';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Narrative } from './narrative';
import type { StoryNarratives } from '@nao/shared/story-app';

const host = vi.hoisted(() => ({ requestNarratives: vi.fn() }));
vi.mock('../story-host', () => ({ requestNarratives: host.requestNarratives }));

afterEach(cleanup);

describe('Narrative', () => {
	it('does not render stored narrative text while loading or when missing text must be redacted', async () => {
		let resolveNarratives!: (narratives: StoryNarratives) => void;
		host.requestNarratives.mockReturnValue(
			new Promise((resolve) => {
				resolveNarratives = resolve;
			}),
		);

		render(<Narrative id='computed-at-runtime'>Owner-only numbers</Narrative>);

		expect(screen.queryByText('Owner-only numbers')).toBeNull();
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

		await act(async () => {
			resolveNarratives({ [STORY_NARRATIVES_REDACT_MISSING_KEY]: '' });
		});

		expect(screen.queryByText('Owner-only numbers')).toBeNull();
		expect(document.querySelector('[aria-busy="true"]')).toBeNull();
	});
});
