import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [
		inferAdditionalFields({
			user: {
				requiresPasswordReset: {
					type: 'boolean',
				},
			},
		}),
	],
});

export const { useSession, signIn, signUp, signOut } = authClient;

const handleGoogleSignIn = async () => {
	await authClient.signIn.social({
		provider: 'google',
		callbackURL: '/',
		errorCallbackURL: '/login',
	});
};

export { handleGoogleSignIn };
