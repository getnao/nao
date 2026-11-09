// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Narrative } from './narrative';

const host = vi.hoisted(() => ({ requestNarratives: vi.fn() }));
vi.mock('../story-host', () => ({ requestNarratives: host.requestNarratives }));

afterEach(cleanup);

describe('Narrative', () => {
	it('does not render stored narrative text while viewer-safe text is loading', () => {
		host.requestNarratives.mockReturnValue(new Promise(() => {}));

		render(<Narrative id='summary'>Owner-only numbers</Narrative>);

		expect(screen.queryByText('Owner-only numbers')).toBeNull();
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
	});
});
