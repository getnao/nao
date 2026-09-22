import type { DateFormatSettings } from '@nao/shared/date';

import { getBrowser } from './headless-browser';
import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

const A4_PRINTABLE_WIDTH_PX = 714;
const A4_PRINTABLE_HEIGHT_PX = 1043;

export async function generateStoryPdf(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
): Promise<Buffer> {
	const html = await generateStoryHtml(story, queryData, dateFormat);
	const hasMaps = html.includes('class="nao-map"');
	const browser = await getBrowser();
	const page = await browser.newPage();

	try {
		if (hasMaps) {
			await page.emulateMediaType('print');
			await page.setViewport({
				width: A4_PRINTABLE_WIDTH_PX,
				height: A4_PRINTABLE_HEIGHT_PX,
				deviceScaleFactor: 2,
			});
		}
		await page
			.setContent(html, { waitUntil: hasMaps ? 'load' : 'domcontentloaded', timeout: 30000 })
			.catch(() => {});
		if (hasMaps) {
			await page.waitForFunction('window.__naoMapsReady === true', { timeout: 15000 }).catch(() => {});
		}
		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
		});
		return Buffer.from(pdfBuffer);
	} finally {
		await page.close();
	}
}
