import { MAX_IMAGE_BYTES, MAX_SOURCE_IMAGES, type SourceImageMediaType } from '@nao/shared/story-theme-source';
import * as cheerio from 'cheerio';
import { type UnzipFileFilter, unzipSync } from 'fflate';

import { type DesignSignals, DesignSourceError, emptySignals, normalizeColor, signalsFromCss } from './signals';

/**
 * Reads design signals from a ZIP of brand assets: stylesheets and token
 * files are parsed as text, and the largest raster images are kept as visual
 * evidence for a vision-capable model or for pixel sampling.
 */

export interface ZipImage {
	name: string;
	mediaType: SourceImageMediaType;
	data: Uint8Array;
}

export interface ZipSignals {
	signals: DesignSignals;
	images: ZipImage[];
}

type EntryKind = 'style' | 'markup' | 'token' | 'image';

interface ZipScan {
	entries: Record<string, Uint8Array>;
	skippedLarge: string[];
	unread: string[];
	skippedOverBudget: number;
	imageCount: number;
}

const MAX_ENTRIES = 400;
const MAX_TEXT_BYTES_PER_FILE = 1_500_000;
const MAX_TEXT_BYTES_TOTAL = 6_000_000;
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);
const MAX_TOKEN_DEPTH = 32;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

const STYLE_EXTENSIONS = /\.(css|scss|sass|less|styl)$/i;
const MARKUP_EXTENSIONS = /\.(html?|svg)$/i;
const TOKEN_EXTENSIONS = /\.(json|tokens|ya?ml)$/i;
const PDF_EXTENSION = /\.pdf$/i;
const IMAGE_EXTENSIONS: Record<string, ZipImage['mediaType']> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	jpe: 'image/jpeg',
	jfif: 'image/jpeg',
	webp: 'image/webp',
};

export function extractSignalsFromZip(zip: Uint8Array, label: string): ZipSignals {
	const scan = readEntries(zip);
	const styleText: string[] = [];
	const tokenColors: Record<string, string> = {};
	const images: ZipImage[] = [];
	const skippedEmpty: string[] = [];
	const unread = [...scan.unread];

	for (const [name, bytes] of Object.entries(scan.entries)) {
		const base = basename(name);
		switch (kindOf(base)) {
			case 'style':
				styleText.push(decodeText(bytes));
				break;
			case 'markup':
				styleText.push(inlineStyles(decodeText(bytes)));
				break;
			case 'token':
				Object.assign(tokenColors, collectTokenColors(decodeText(bytes), base));
				break;
			case 'image': {
				const image = readImage(base, bytes);
				if (image) {
					images.push(image);
				} else if (bytes.byteLength === 0) {
					skippedEmpty.push(base);
				} else {
					unread.push(base);
				}
				break;
			}
		}
	}

	const hasText = styleText.some((text) => text.trim().length > 0) || Object.keys(tokenColors).length > 0;
	if (!hasText && images.length === 0) {
		throw new DesignSourceError(emptyZipMessage(scan.skippedLarge, skippedEmpty, unread));
	}

	const warnings: string[] = [];
	if (!hasText) {
		warnings.push('No stylesheets or token files were found; the theme is read from the images alone.');
	}
	if (scan.skippedLarge.length > 0) {
		warnings.push(`Images larger than ${MAX_IMAGE_MB} MB were skipped: ${scan.skippedLarge.join(', ')}.`);
	}
	if (scan.skippedOverBudget > 0) {
		warnings.push(
			`${scan.skippedOverBudget} ${scan.skippedOverBudget === 1 ? 'file was' : 'files were'} skipped because the ZIP exceeds what nao reads at once.`,
		);
	}
	const tokenCss = Object.entries(tokenColors)
		.map(([token, hex]) => `:root{${token}:${hex};}`)
		.join('\n');
	const signals = signalsFromCss([tokenCss, ...styleText].join('\n'), emptySignals('zip', 'zip', label));
	const keptImages = images.sort((a, b) => b.data.byteLength - a.data.byteLength).slice(0, MAX_SOURCE_IMAGES);
	if (scan.imageCount > keptImages.length) {
		warnings.push(
			`The ZIP has ${scan.imageCount} images; only the ${MAX_SOURCE_IMAGES} largest were read: ${keptImages.map((image) => image.name).join(', ')}.`,
		);
	}

	return { signals: { ...signals, warnings }, images: keptImages };
}

function emptyZipMessage(skippedLarge: string[], skippedEmpty: string[], unread: string[]): string {
	if (skippedLarge.length > 0) {
		return skippedLarge.length === 1
			? `${skippedLarge[0]} is larger than ${MAX_IMAGE_MB} MB, which is the limit for images inside a ZIP.`
			: `Images in the ZIP are larger than ${MAX_IMAGE_MB} MB: ${skippedLarge.join(', ')}.`;
	}
	if (skippedEmpty.length > 0) {
		return skippedEmpty.length === 1
			? `${skippedEmpty[0]} in the ZIP is empty.`
			: `These images in the ZIP are empty: ${skippedEmpty.join(', ')}.`;
	}
	const found = unread.slice(0, 6);
	const extra = found.length > 0 ? ` Found ${found.join(', ')}.` : '';
	return `The ZIP contains no stylesheets, token files or images that nao can read (css, scss, json, html, svg, png, jpg, webp).${extra}`;
}

function readEntries(zip: Uint8Array): ZipScan {
	const scan: ZipScan = { entries: {}, skippedLarge: [], unread: [], skippedOverBudget: 0, imageCount: 0 };
	let count = 0;
	let textBudget = MAX_TEXT_BYTES_TOTAL;
	const largestImages = largestImageNames(zip);

	const filter: UnzipFileFilter = (file) => {
		const base = basename(file.name);
		if (!base || base.startsWith('.') || file.name.includes('__MACOSX')) {
			return false;
		}
		if (PDF_EXTENSION.test(base)) {
			return false;
		}
		const kind = kindOf(base);
		if (!kind || (file.compression !== ZIP_STORED && file.compression !== ZIP_DEFLATED)) {
			scan.unread.push(base);
			return false;
		}
		count++;
		if (count > MAX_ENTRIES) {
			scan.skippedOverBudget++;
			return false;
		}
		if (kind === 'image') {
			if (file.originalSize > MAX_IMAGE_BYTES) {
				scan.skippedLarge.push(`${base} (${formatMb(file.originalSize)} MB)`);
				return false;
			}
			scan.imageCount++;
			return largestImages.has(file.name);
		}
		if (file.originalSize > MAX_TEXT_BYTES_PER_FILE || file.originalSize > textBudget) {
			scan.skippedOverBudget++;
			return false;
		}
		textBudget -= file.originalSize;
		return true;
	};

	try {
		scan.entries = unzipSync(zip, { filter });
	} catch {
		throw new DesignSourceError('That file is not a ZIP nao can open.');
	}
	return scan;
}

/** Read from entry metadata alone, so a large image late in the archive is not crowded out by earlier small ones. */
function largestImageNames(zip: Uint8Array): Set<string> {
	const candidates: { name: string; size: number }[] = [];
	try {
		unzipSync(zip, {
			filter: (file) => {
				const base = basename(file.name);
				const isCandidate =
					base !== '' &&
					!base.startsWith('.') &&
					!file.name.includes('__MACOSX') &&
					kindOf(base) === 'image' &&
					(file.compression === ZIP_STORED || file.compression === ZIP_DEFLATED) &&
					file.originalSize <= MAX_IMAGE_BYTES;
				if (isCandidate) {
					candidates.push({ name: file.name, size: file.originalSize });
				}
				return false;
			},
		});
	} catch {
		throw new DesignSourceError('That file is not a ZIP nao can open.');
	}
	return new Set(
		candidates
			.sort((a, b) => b.size - a.size)
			.slice(0, MAX_SOURCE_IMAGES)
			.map((candidate) => candidate.name),
	);
}

function kindOf(base: string): EntryKind | null {
	if (STYLE_EXTENSIONS.test(base)) {
		return 'style';
	}
	if (MARKUP_EXTENSIONS.test(base)) {
		return 'markup';
	}
	if (TOKEN_EXTENSIONS.test(base)) {
		return 'token';
	}
	return Object.hasOwn(IMAGE_EXTENSIONS, extensionOf(base)) ? 'image' : null;
}

function decodeText(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function readImage(name: string, bytes: Uint8Array): ZipImage | null {
	if (bytes.byteLength === 0) {
		return null;
	}
	const mediaType = imageMediaType(bytes);
	return mediaType ? { name, mediaType, data: bytes } : null;
}

function imageMediaType(bytes: Uint8Array): ZipImage['mediaType'] | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'image/png';
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

function extensionOf(name: string): string {
	return name.split('.').pop()?.toLowerCase() ?? '';
}

function basename(path: string): string {
	const parts = path.replaceAll('\\', '/').split('/');
	return parts[parts.length - 1] ?? path;
}

function formatMb(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

/** Flattens the styling found in HTML or SVG markup into CSS text the stylesheet reader understands. */
function inlineStyles(markup: string): string {
	const $ = cheerio.load(markup);
	const blocks = $('style')
		.map((_, element) => $(element).text())
		.get();
	const attributes = $('[style]')
		.map((_, element) => `x{${$(element).attr('style')}}`)
		.get();
	const svgPaint = $('[fill], [stroke]')
		.map((_, element) =>
			(['fill', 'stroke'] as const)
				.filter((paint) => $(element).attr(paint))
				.map((paint) => `x{${paint}:${$(element).attr(paint)};}`)
				.join('\n'),
		)
		.get();
	return [...blocks, ...attributes, ...svgPaint].join('\n');
}

function collectTokenColors(text: string, fileName: string): Record<string, string> {
	const out: Record<string, string> = {};
	const prefix = fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-');
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		for (const [, key, value] of text.matchAll(
			/^\s*([\w.-]+)\s*:\s*['"]?(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gim,
		)) {
			const hex = normalizeColor(value);
			if (hex) {
				out[`--${prefix}-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`] = hex;
			}
		}
		return out;
	}
	walk(parsed, [prefix], 0);
	return out;

	/** Token files are a few levels deep; anything deeper is skipped rather than recursed into. */
	function walk(node: unknown, path: string[], depth: number) {
		if (depth > MAX_TOKEN_DEPTH) {
			return;
		}
		if (typeof node === 'string') {
			const hex = normalizeColor(node);
			if (hex) {
				out[
					`--${path
						.join('-')
						.replace(/[^a-z0-9-]+/gi, '-')
						.toLowerCase()}`
				] = hex;
			}
			return;
		}
		if (node && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				if (key === '$value' || key === 'value') {
					walk(value, path, depth + 1);
				} else if (!key.startsWith('$')) {
					walk(value, [...path, key], depth + 1);
				}
			}
		}
	}
}
