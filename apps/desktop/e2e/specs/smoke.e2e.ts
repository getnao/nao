import { $, browser, expect } from '@wdio/globals';

import { BACKEND_URL } from '../support/backend';
import { authorizeDesktopApp, parseSignInLink, sendLoopbackCallback, signUpTestUser } from '../support/sign-in';

const IPC_RESPONSE_TIMEOUT_MS = 5_000;

describe('nao desktop app', () => {
	let sessionCookie: string;

	before(async () => {
		sessionCookie = await signUpTestUser();
	});

	it('starts on the server picker with nao Cloud', async () => {
		await expect($('[data-testid="server-list"]')).toBeDisplayed();
		await expect($('//*[@data-testid="server-list"]//*[text()="nao Cloud"]')).toBeDisplayed();
	});

	it('adds a self-hosted server and sends the user to the browser sign-in', async () => {
		await $('//button[contains(., "Add a server")]').click();
		await $('input[name="url"]').setValue(BACKEND_URL);
		await expect($('//*[contains(text(), "sent unencrypted")]')).toBeDisplayed();
		await $('button[type="submit"]').click();

		const signInLink = await $('[data-testid="sign-in-link"]');
		await signInLink.waitForDisplayed();
		expect(parseSignInLink(await signInLink.getValue()).port).toBeGreaterThan(0);
	});

	it('signs in through the loopback callback and loads the chat page', async () => {
		const loopback = parseSignInLink(await $('[data-testid="sign-in-link"]').getValue());
		const code = await authorizeDesktopApp(sessionCookie);

		const callback = await sendLoopbackCallback(loopback, code);
		expect(callback.status).toBe(200);
		expect(await callback.text()).toContain('return to the nao app');

		await browser.waitUntil(async () => (await browser.getUrl()) === `${BACKEND_URL}/`, {
			timeoutMsg: 'The app did not open the server after signing in',
		});
		await expect($('//*[contains(text(), "what do you want to analyze?")]')).toBeDisplayed();
	});

	it('gives the server page no access to the app commands', async () => {
		const result = await browser.execute(tryInvokingAppCommand, IPC_RESPONSE_TIMEOUT_MS);

		expect(result).not.toBe('allowed');
	});
});

/** Runs inside the server page, which must not be able to call the commands of the bundled UI. */
function tryInvokingAppCommand(timeoutMs: number): Promise<string> {
	type TauriInternals = { invoke: (command: string) => Promise<unknown> };
	const internals = (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
	if (!internals) {
		return Promise.resolve('no IPC bridge');
	}

	const invocation = internals.invoke('list_servers').then(
		() => 'allowed',
		(error: unknown) => `rejected: ${String(error)}`,
	);
	const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('no response'), timeoutMs));
	return Promise.race([invocation, timeout]);
}
