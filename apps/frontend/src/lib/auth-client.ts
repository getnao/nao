import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({});

export const { useSession, signIn, signUp, signOut } = authClient;

const handleGoogleSignIn = async () => {
	await authClient.signIn.social({
		provider: 'google',
		errorCallbackURL: '/signup',
	});
};

export { handleGoogleSignIn };
