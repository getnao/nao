import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { genericOAuthClient, inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
	plugins: [
		oauthProviderClient(),
		inferAdditionalFields({
			user: {
				requiresPasswordReset: {
					type: 'boolean',
				},
				messagingProviderCode: {
					type: 'string',
				},
			},
		}),
		genericOAuthClient(),
		twoFactorClient(),
	],
});

export const {
	useSession,
	signIn,
	signUp,
	signOut,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
	twoFactor,
} = authClient;

/** The auth client resolves with `{ data, error }`, while mutations expect a rejection. */
export async function unwrapAuthResult<Data>(
	request: Promise<{ data: Data | null; error: { message?: string } | null }>,
): Promise<Data> {
	const { data, error } = await request;
	if (error || data === null) {
		throw new Error(error?.message ?? 'Something went wrong. Please try again.');
	}
	return data;
}

const handleGoogleSignIn = async (callbackURL = '/') => {
	await authClient.signIn.social({
		provider: 'google',
		callbackURL,
		errorCallbackURL: '/login',
	});
};

const handleGithubSignIn = async (callbackURL = '/') => {
	await authClient.signIn.social({
		provider: 'github',
		callbackURL,
		errorCallbackURL: '/login',
	});
};

const handleGitlabSignIn = async (callbackURL = '/') => {
	await authClient.signIn.social({
		provider: 'gitlab',
		callbackURL,
		errorCallbackURL: '/login',
	});
};

const handleOidcSignIn = async (providerId: string, callbackURL = '/') => {
	await authClient.signIn.oauth2({
		providerId,
		callbackURL,
		errorCallbackURL: '/login',
	});
};

/** Redirects to the identity provider of the organization that owns the email's domain, or returns the refusal. */
const handleSsoSignIn = async (email: string, callbackURL = '/'): Promise<string | undefined> => {
	const { data, error } = await authClient.$fetch<{ url: string }>('/sign-in/sso', {
		method: 'POST',
		body: { email, callbackURL, errorCallbackURL: '/login' },
	});
	if (error) {
		return error.message;
	}
	window.location.href = data.url;
};

export { handleGithubSignIn, handleGitlabSignIn, handleGoogleSignIn, handleOidcSignIn, handleSsoSignIn };
