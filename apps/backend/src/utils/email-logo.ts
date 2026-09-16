import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EmailAttachment } from '../types/email';

export const EMAIL_LOGO_CID = 'nao-logo';

export const emailLogoAttachment: EmailAttachment | undefined = loadEmailLogo();

function loadEmailLogo(): EmailAttachment | undefined {
	const logoPath = resolveLogoPath();
	if (!logoPath) {
		return undefined;
	}
	return {
		filename: 'nao-logo.png',
		content: readFileSync(logoPath),
		contentType: 'image/png',
		cid: EMAIL_LOGO_CID,
	};
}

function resolveLogoPath(): string | undefined {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const executableDir = dirname(process.execPath);
	const candidates = [
		join(executableDir, 'public'),
		join(currentDir, 'public'),
		join(currentDir, '../public'),
		join(currentDir, '../../public'),
		join(currentDir, '../../../frontend/dist'),
		join(currentDir, '../../../frontend/public'),
	];
	return candidates.map((directory) => join(directory, 'appicon.png')).find((path) => existsSync(path));
}
