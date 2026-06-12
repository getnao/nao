import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { genericOAuthClient, inferAdditionalFields } from 'better-auth/client/plugins';
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
	],
});

export const { useSession, signIn, signUp, signOut, requestPasswordReset, resetPassword } = authClient;

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

const handleOidcSignIn = async (providerId: string, callbackURL = '/') => {
	await authClient.signIn.oauth2({
		providerId,
		callbackURL,
		errorCallbackURL: '/login',
	});
};

export { handleGithubSignIn, handleGoogleSignIn, handleOidcSignIn };
