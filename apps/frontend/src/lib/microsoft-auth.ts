/* @license Enterprise */

import { authClient } from './auth-client';

export async function handleMicrosoftSignIn(): Promise<void> {
	await authClient.signIn.social({
		provider: 'microsoft',
		callbackURL: '/',
		errorCallbackURL: '/login',
	});
}
