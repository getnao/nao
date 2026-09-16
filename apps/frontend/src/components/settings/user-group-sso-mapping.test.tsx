// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

	it('keeps an overridden saved mapping visible and removable', () => {
		render(
			<MappingHarness
				initialIdentifiers={['finance']}
				effectiveEnvMappings={[
					{ identifier: 'finance', targetGroupId: 'marketing-id', targetGroupName: 'Marketing' },
				]}
				currentGroupId='analysts-id'
			/>,
		);

		expect(screen.getByText('finance')).toBeTruthy();
		expect(screen.getByText('Overridden by .env → maps to Marketing')).toBeTruthy();
		expect(screen.getByLabelText('Overridden by .env to Marketing')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Remove Okta group finance' }));
		expect(screen.queryByText('finance')).toBeNull();
	});

	it('shows a same-target env mapping once without a remove control', () => {
		render(
			<MappingHarness
				initialIdentifiers={['finance']}
				effectiveEnvMappings={[
					{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
				]}
				currentGroupId='analysts-id'
			/>,
		);

		expect(screen.getAllByText('finance')).toHaveLength(1);
		expect(screen.getByLabelText('.env controlled mapping')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove Okta group finance' })).toBeNull();
	});

	it('keeps ordinary OIDC and Microsoft mappings editable', () => {
		const { rerender } = render(<MappingHarness initialIdentifiers={['finance']} currentGroupId='analysts-id' />);
		expect(screen.getByRole('button', { name: 'Remove Okta group finance' })).toBeTruthy();

		rerender(
			<UserGroupSsoMapping
				identifiers={['00000000-0000-4000-8000-000000000000']}
				provider='microsoft'
				providerName='Microsoft Entra'
				onChange={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole('button', {
				name: 'Remove Microsoft Entra group 00000000-0000-4000-8000-000000000000',
			}),
		).toBeTruthy();
	});

	it('renders an added Microsoft Entra object ID immediately', () => {
		render(<MappingHarness initialIdentifiers={[]} provider='microsoft' providerName='Microsoft Entra' />);

		fireEvent.change(screen.getByRole('textbox', { name: 'Microsoft Entra group object ID' }), {
			target: { value: 'A0B1C2D3-E4F5-6789-ABCD-EF0123456789' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add group' }));

		expect(
			screen.getByRole('button', {
				name: 'Remove Microsoft Entra group a0b1c2d3-e4f5-6789-abcd-ef0123456789',
			}),
		).toBeTruthy();
	});

	it('shows Entra env mappings as read-only and keeps an overridden UI mapping inactive', () => {
		const envGroupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		const uiGroupId = '11111111-2222-3333-4444-555555555555';
		render(
			<MappingHarness
				provider='microsoft'
				providerName='Microsoft Entra'
				initialIdentifiers={[envGroupId, uiGroupId]}
				currentGroupId='ui-target'
				effectiveEnvMappings={[
					{ identifier: envGroupId, targetGroupId: 'env-target', targetGroupName: 'Env Analysts' },
					{ identifier: uiGroupId, targetGroupId: 'ui-target', targetGroupName: 'UI Analysts' },
				]}
			/>,
		);

		expect(screen.getByText('Overridden by .env → maps to Env Analysts')).toBeTruthy();
		expect(screen.getByLabelText('.env controlled mapping')).toBeTruthy();
		expect(screen.getByRole('button', { name: `Remove Microsoft Entra group ${envGroupId}` })).toBeTruthy();
		expect(screen.queryByRole('button', { name: `Remove Microsoft Entra group ${uiGroupId}` })).toBeNull();
	});

	it('shows an unresolved env target as an override without a false active env row', () => {
		const identifier = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		render(
			<MappingHarness
				provider='microsoft'
				providerName='Microsoft Entra'
				initialIdentifiers={[identifier]}
				currentGroupId='ui-target'
				effectiveEnvMappings={[{ identifier, targetGroupId: null, targetGroupName: 'missing analysts' }]}
			/>,
		);

		expect(screen.getByText('Overridden by .env → maps to missing analysts')).toBeTruthy();
		expect(screen.queryByLabelText('.env controlled mapping')).toBeNull();
		expect(screen.getByRole('button', { name: `Remove Microsoft Entra group ${identifier}` })).toBeTruthy();
	});

	it('shows env loading and error states without hiding saved mappings', () => {
		const { rerender } = render(<MappingHarness initialIdentifiers={['finance']} envMappingsState='loading' />);
		expect(screen.getByText('Loading .env mappings...')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove Okta group finance' })).toBeTruthy();

		rerender(<MappingHarness initialIdentifiers={['finance']} envMappingsState='error' />);
		expect(screen.getByText('Failed to load .env mappings.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove Okta group finance' })).toBeTruthy();
	});
});

function MappingHarness({
	initialIdentifiers = Array.from({ length: 200 }, (_, index) => `group-${index}`),
	provider = 'oidc',
	providerName = 'Okta',
	currentGroupId,
	effectiveEnvMappings,
	envMappingsState,
}: {
	initialIdentifiers?: string[];
	provider?: 'oidc' | 'microsoft';
	providerName?: string;
	currentGroupId?: string;
	effectiveEnvMappings?: Array<{
		identifier: string;
		targetGroupId: string | null;
		targetGroupName: string;
	}>;
	envMappingsState?: 'ready' | 'loading' | 'error';
}) {
	const [identifiers, setIdentifiers] = useState(initialIdentifiers);
	return (
		<UserGroupSsoMapping
			identifiers={identifiers}
			provider={provider}
			providerName={providerName}
			currentGroupId={currentGroupId}
			effectiveEnvMappings={effectiveEnvMappings}
			envMappingsState={envMappingsState}
			onChange={setIdentifiers}
		/>
	);
}
