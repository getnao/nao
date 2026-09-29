// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Expandable } from './expandable';

describe('Expandable', () => {
	afterEach(cleanup);

	it('keeps a plain header trigger shrinkable beside trailing content', () => {
		const title = 'A title long enough to need truncation within the available header width';

		render(
			<Expandable
				title={title}
				titleAction={null}
				trailingContent={<span>Trailing content</span>}
				expanded={false}
				onExpandedChange={vi.fn()}
				variant='plain'
			>
				Content
			</Expandable>,
		);

		const trigger = screen.getByRole('button', { name: title });

		expect(trigger.className).toContain('min-w-0');
		expect(trigger.className).toContain('flex-1');
		expect(trigger.className).not.toContain('flex-none');
		expect(trigger.parentElement?.className).toContain('w-auto');
		expect(trigger.parentElement?.className).toContain('min-w-0');
		expect(trigger.parentElement?.className).toContain('shrink');
	});
});
