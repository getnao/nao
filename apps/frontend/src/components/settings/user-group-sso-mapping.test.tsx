// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { UserGroupSsoMapping } from './user-group-sso-mapping';

afterEach(cleanup);

describe('UserGroupSsoMapping', () => {
	it('blocks additions at 200 identifiers and explains how to continue', () => {
		render(<MappingHarness />);

		const addButton = screen.getByRole('button', { name: 'Add group' }) as HTMLButtonElement;
		expect(addButton.disabled).toBe(true);
		expect(screen.getByRole('status').textContent).toBe(
			'Maximum of 200 groups reached. Remove one to add another.',
		);
		expect(addButton.getAttribute('aria-describedby')).toBe('sso-group-mapping-oidc-feedback');

		fireEvent.click(screen.getByRole('button', { name: 'Remove Okta group group-0' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Okta group name' }), {
			target: { value: 'new-group' },
		});

		expect(screen.queryByRole('status')).toBeNull();
		expect(addButton.disabled).toBe(false);
	});
});

function MappingHarness() {
	const [identifiers, setIdentifiers] = useState(Array.from({ length: 200 }, (_, index) => `group-${index}`));
	return (
		<UserGroupSsoMapping identifiers={identifiers} provider='oidc' providerName='Okta' onChange={setIdentifiers} />
	);
}
