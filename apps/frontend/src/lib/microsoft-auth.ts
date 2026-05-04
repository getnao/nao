/* @license Enterprise */

import { authClient } from './auth-client';

export async function handleMicrosoftSignIn(callbackURL = '/'): Promise<void> {
	await authClient.signIn.social({
		provider: 'microsoft',
		callbackURL,
		errorCallbackURL: '/login',
	});
}
