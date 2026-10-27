// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailVerified } from './email-verified';
import { Login } from './login';
import { SignUp } from './signup';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	formValues: {} as Record<string, string | boolean>,
	navigate: vi.fn(),
	publicConfig: { enableUserLogin: true, enableUserSignup: true, naoMode: 'cloud' },
	push: vi.fn(),
	searchByPath: {} as Record<string, { error?: string; redirect?: string }>,
	signInEmail: vi.fn(),
	signUpEmail: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: (path: string) => (options: Record<string, unknown>) => ({
		...options,
		useSearch: () => mocks.searchByPath[path] ?? {},
	}),
	Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
	useNavigate: () => mocks.navigate,
	useRouter: () => ({ history: { push: mocks.push } }),
}));

vi.mock('@tanstack/react-form', () => ({
	useForm: (options: { onSubmit: (input: { value: Record<string, string | boolean> }) => Promise<void> }) => ({
		submit: () => options.onSubmit({ value: mocks.formValues }),
	}),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string }) =>
		options.queryKey === 'public-config'
			? { data: mocks.publicConfig, isLoading: false }
			: { data: true, isLoading: false },
}));

vi.mock('@/main', () => ({
	trpc: {
		authConfig: { smtp: { isSetup: { queryOptions: () => ({ queryKey: 'smtp' }) } } },
		system: { getPublicConfig: { queryOptions: () => ({ queryKey: 'public-config' }) } },
	},
}));

vi.mock('@/components/auth-form', () => ({
	AuthForm: ({
		content,
		form,
		serverError,
		title,
	}: {
		content?: ReactNode;
		form?: { submit: () => Promise<void> };
		serverError?: string;
		title: string;
	}) => (
		<div>
			<h1>{title}</h1>
			{serverError && <p role='alert'>{serverError}</p>}
			{content ?? <button onClick={() => void form?.submit()}>Submit</button>}
		</div>
	),
	FormTextField: () => null,
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => mocks.publicConfig.naoMode === 'cloud',
}));

vi.mock('@/lib/auth-client', () => ({
	sendVerificationEmail: vi.fn(),
	signIn: { email: (...args: unknown[]) => mocks.signInEmail(...args) },
	signUp: { email: (...args: unknown[]) => mocks.signUpEmail(...args) },
}));

vi.mock('@/lib/last-sign-in-method', () => ({
	rememberSignInMethod: vi.fn(),
}));

describe('email verification auth routes', () => {
	beforeEach(() => {
		mocks.formValues = {};
		mocks.publicConfig = { enableUserLogin: true, enableUserSignup: true, naoMode: 'cloud' };
		mocks.searchByPath = {};
		mocks.navigate.mockReset();
		mocks.push.mockReset();
		mocks.signInEmail.mockReset();
		mocks.signUpEmail.mockReset();
		window.history.replaceState({}, '', '/');
	});

	afterEach(cleanup);

	it('replaces successful cloud sign-up with a check-inbox state', async () => {
		mocks.searchByPath['/signup'] = { redirect: '/settings' };
		mocks.formValues = {
			name: 'New User',
			email: 'new@example.com',
			password: 'password123',
			requiresPasswordReset: false,
			messagingProviderCode: '',
		};
		mocks.signUpEmail.mockResolvedValue({ error: null });

		render(<SignUp />);
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeTruthy();
		expect(mocks.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'new@example.com',
				callbackURL: '/email-verified?redirect=%2Fsettings',
			}),
			{ disableSignal: true },
		);
		expect(mocks.navigate).not.toHaveBeenCalledWith({ to: '/' });

		fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
		expect(screen.getByRole('heading', { name: 'Sign up' })).toBeTruthy();
	});

	it('uses the post-login destination while showing check-inbox for an unverified user', async () => {
		mocks.searchByPath['/login'] = { redirect: '/settings' };
		mocks.formValues = { email: 'new@example.com', password: 'password123' };
		mocks.signInEmail.mockResolvedValue({
			error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' },
		});

		render(<Login />);
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		await waitFor(() => expect(screen.getByRole('heading', { name: 'Check your inbox' })).toBeTruthy());
		expect(mocks.signInEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'new@example.com',
				callbackURL: '/settings',
			}),
		);
	});

	it('keeps the verified email tab on a completion screen with a continue fallback', () => {
		mocks.searchByPath['/email-verified'] = { redirect: '/settings' };

		render(<EmailVerified />);
		fireEvent.click(screen.getByRole('button', { name: 'Continue to nao' }));

		expect(mocks.push).toHaveBeenCalledWith('/settings');
	});

	it('shows friendly recovery copy for an expired verification link', () => {
		mocks.searchByPath['/login'] = { error: 'TOKEN_EXPIRED', redirect: '/settings' };

		render(<Login />);

		expect(screen.getByRole('alert').textContent).toContain('verification link has expired');
		expect(screen.queryByText('TOKEN_EXPIRED')).toBeNull();
	});
});
