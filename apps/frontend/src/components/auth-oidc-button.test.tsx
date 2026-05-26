// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OidcSignInButton } from './auth-oidc-button';

vi.mock('@/components/icons/okta-icon.svg', () => ({
	default: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='okta-icon' {...props} />,
}));
vi.mock('@/components/icons/auth0-icon.svg', () => ({
	default: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='auth0-icon' {...props} />,
}));
vi.mock('@/components/icons/keycloak-icon.svg', () => ({
	default: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='keycloak-icon' {...props} />,
}));

const mockHandleOidcSignIn = vi.fn();
vi.mock('@/lib/auth-client', () => ({
	handleOidcSignIn: (...args: unknown[]) => mockHandleOidcSignIn(...args),
}));

describe('OidcSignInButton', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('renders the button with provider name', () => {
		render(<OidcSignInButton providerId='okta' providerName='Okta' />);
		expect(screen.getByRole('button', { name: /continue with okta/i })).toBeDefined();
	});

	it('shows Okta icon for okta provider', () => {
		render(<OidcSignInButton providerId='okta' providerName='Okta' />);
		expect(screen.getByTestId('okta-icon')).toBeDefined();
	});

	it('shows Auth0 icon for auth0 provider', () => {
		render(<OidcSignInButton providerId='auth0' providerName='Auth0' />);
		expect(screen.getByTestId('auth0-icon')).toBeDefined();
	});

	it('shows Keycloak icon for keycloak provider', () => {
		render(<OidcSignInButton providerId='keycloak' providerName='Keycloak' />);
		expect(screen.getByTestId('keycloak-icon')).toBeDefined();
	});

	it('is case-insensitive for provider ID matching', () => {
		render(<OidcSignInButton providerId='Okta' providerName='Okta' />);
		expect(screen.getByTestId('okta-icon')).toBeDefined();
	});

	it('falls back to generic icon for unknown providers', () => {
		render(<OidcSignInButton providerId='custom-idp' providerName='My IDP' />);
		expect(screen.queryByTestId('okta-icon')).toBeNull();
		expect(screen.queryByTestId('auth0-icon')).toBeNull();
		expect(screen.queryByTestId('keycloak-icon')).toBeNull();
		expect(screen.getByRole('button', { name: /continue with my idp/i })).toBeDefined();
	});

	it('calls handleOidcSignIn with providerId and callbackUrl on click', () => {
		render(<OidcSignInButton providerId='okta' providerName='Okta' callbackUrl='/dashboard' />);
		fireEvent.click(screen.getByRole('button'));
		expect(mockHandleOidcSignIn).toHaveBeenCalledWith('okta', '/dashboard');
	});

	it('calls handleOidcSignIn with undefined callbackUrl when not provided', () => {
		render(<OidcSignInButton providerId='okta' providerName='Okta' />);
		fireEvent.click(screen.getByRole('button'));
		expect(mockHandleOidcSignIn).toHaveBeenCalledWith('okta', undefined);
	});
});
