import { describe, expect, it } from 'vitest';

import { isDisposableEmail } from '../../src/utils/disposable-email';

describe('isDisposableEmail', () => {
	it.each([
		['a listed disposable domain', 'probe@maildrop.cc', true],
		['a subdomain of a listed domain', 'probe@inbox.maildrop.cc', true],
		['a listed domain in upper case', 'probe@MailDrop.CC', true],
		['a reserved documentation domain', 'probe1@example.com', true],
		['a reserved top-level domain', 'probe@nao.test', true],
		['a public mailbox provider', 'someone@gmail.com', false],
		['a company domain', 'someone@getnao.io', false],
		['a domain that only ends like a listed one', 'someone@notmaildrop.cc', false],
		['a listed domain used as the local part', 'maildrop.cc@getnao.io', false],
	])('%s', (_name, email, expected) => {
		expect(isDisposableEmail(email)).toBe(expected);
	});
});
