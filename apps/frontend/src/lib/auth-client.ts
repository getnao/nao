import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

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

export { handleGithubSignIn, handleGoogleSignIn };
