import { MAX_PDF_BYTES, MAX_SOURCE_IMAGES } from '@nao/shared/story-theme-source';
import { unzipSync } from 'fflate';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFPageProxy } from 'pdfjs-dist';

export interface RenderedPdf {
	fileName: string;
	pageCount: number;
	pages: { data: string; mediaType: 'image/jpeg' }[];
}

const MAX_PAGE_WIDTH_PX = 1600;
const MAX_PAGE_HEIGHT_PX = 2400;
const MAX_PAGE_SCALE = 2;
const JPEG_QUALITY = 0.85;
const MAX_ZIP_PDF_BYTES = 2 * MAX_PDF_BYTES;

/** Pages are spread across the document: covers rarely carry the palette, style-guide pages further in do. */
export async function renderPdfPages(
	fileName: string,
	bytes: Uint8Array,
	maxPages = MAX_SOURCE_IMAGES,
): Promise<RenderedPdf> {
	const pdfjs = await import('pdfjs-dist');
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	const pdf = await pdfjs.getDocument({ data: bytes }).promise;
	try {
		const pages = [];
		for (const pageNumber of spreadPageNumbers(pdf.numPages, maxPages)) {
			pages.push(await renderPage(await pdf.getPage(pageNumber)));
		}
		return { fileName, pageCount: pdf.numPages, pages };
	} finally {
		await pdf.destroy();
	}
}

/** PDFs inside a brand ZIP are rendered here too, sharing the same page budget as a standalone PDF. */
export async function renderZipPdfs(zip: Uint8Array, maxPages: number): Promise<RenderedPdf[]> {
	const entries = readZipEntries(zip, maxPages);
	const rendered: RenderedPdf[] = [];
	let remaining = maxPages;
	for (const [name, bytes] of Object.entries(entries).sort(([, a], [, b]) => b.byteLength - a.byteLength)) {
		if (remaining <= 0) {
			break;
		}
		const pdf = await renderPdfPages(basename(name), bytes, remaining).catch(() => null);
		if (pdf) {
			rendered.push(pdf);
			remaining -= pdf.pages.length;
		}
	}
	return rendered;
}

function readZipEntries(zip: Uint8Array, maxPages: number): Record<string, Uint8Array> {
	let acceptedCount = 0;
	let acceptedBytes = 0;
	try {
		return unzipSync(zip, {
			filter: (file) => {
				const isCandidate =
					/\.pdf$/i.test(file.name) &&
					!file.name.includes('__MACOSX') &&
					!basename(file.name).startsWith('.') &&
					file.originalSize <= MAX_PDF_BYTES;
				if (
					!isCandidate ||
					acceptedCount >= maxPages ||
					acceptedBytes + file.originalSize > MAX_ZIP_PDF_BYTES
				) {
					return false;
				}
				acceptedCount += 1;
				acceptedBytes += file.originalSize;
				return true;
			},
		});
	} catch {
		return {};
	}
}

export function spreadPageNumbers(pageCount: number, maxPages: number): number[] {
	if (pageCount <= maxPages) {
		return Array.from({ length: pageCount }, (_, index) => index + 1);
	}
	if (maxPages <= 1) {
		return [1];
	}
	const step = (pageCount - 1) / (maxPages - 1);
	return [...new Set(Array.from({ length: maxPages }, (_, index) => Math.round(index * step) + 1))];
}

async function renderPage(page: PDFPageProxy): Promise<RenderedPdf['pages'][number]> {
	const baseViewport = page.getViewport({ scale: 1 });
	const scale = Math.min(
		MAX_PAGE_SCALE,
		MAX_PAGE_WIDTH_PX / baseViewport.width,
		MAX_PAGE_HEIGHT_PX / baseViewport.height,
	);
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	await page.render({ canvas, viewport, background: '#ffffff' }).promise;
	const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
	page.cleanup();
	return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
}

function basename(path: string): string {
	return path.split('/').pop() ?? path;
}
