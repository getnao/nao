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

export { handleGithubSignIn, handleGitlabSignIn, handleGoogleSignIn, handleOidcSignIn };
