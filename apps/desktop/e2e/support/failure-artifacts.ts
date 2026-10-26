import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { browser } from '@wdio/globals';

import { e2eOutputPath } from './paths';

/** Keeps a screenshot, the current URL and the page source of a failed test for the CI artifacts. */
export async function saveFailureArtifacts(testTitle: string): Promise<void> {
	await mkdir(e2eOutputPath, { recursive: true });
	const baseName = path.join(e2eOutputPath, testTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase());

	await browser.saveScreenshot(`${baseName}.png`);
	const url = await browser.getUrl();
	const source = await browser.getPageSource();
	await writeFile(`${baseName}.html`, `<!-- ${url} -->\n${source}`);
}
