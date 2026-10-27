import {
	normalizeBrandHeader,
	oppositeStoryThemeMode,
	type StoryTheme,
	type StoryThemeMode,
	storyThemeMode,
	type StoryThemePair,
} from '@nao/shared/story-theme';
import {
	MAX_GENERATION_NOTES,
	MAX_GENERATION_SOURCES,
	MAX_GENERATION_TEXT_LENGTH,
	MAX_SOURCE_NAME_LENGTH,
	type StoryThemeGeneration,
	type StoryThemeSourceRecord,
} from '@nao/shared/story-theme-generation';
import { deriveStoryThemeVariant } from '@nao/shared/story-theme-pair';
import { MAX_SOURCE_IMAGES } from '@nao/shared/story-theme-source';
import type { LlmProvider } from '@nao/shared/types';
import { generateText, Output } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../../agents/providers';
import { llmTelemetry } from '../../agents/telemetry';
import * as llmConfigQueries from '../../queries/project-llm-config.queries';
import { convertToTokenUsage } from '../../utils/ai';
import { resolveDefaultModelSelection, resolveProviderModel } from '../../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../../utils/schedule-task';
import { applyGuards, type GenerateResult, type GuardContext } from './guard';
import { detectGround, type ImageSample, sampleImage, snapToImageColors } from './pixels';
import { fallbackProposal, modelProposalSchema, renderSignals, type ThemeProposal, toThemeProposal } from './proposal';
import {
	type BrandCandidate,
	chromaOf,
	type DesignSignals,
	DesignSourceError,
	mergeSignals,
	normalizeColor,
	SourceRefusedError,
} from './signals';
import { bareHost, extractSignalsFromUrl, type UrlSignals } from './url';
import {
	readWhiteLabelBrand,
	renderWhiteLabelBrand,
	type StoryLogo,
	toStoryLogo,
	type WhiteLabelBrand,
} from './white-label';
import { extractSignalsFromZip } from './zip';

/**
 * Turns design signals into a story theme for the editor preview. A model does
 * the part that needs judgement (which of forty colours is the page, which is
 * the accent); when the project has none, or the model fails, a deterministic
 * mapping reads the strongest signals directly. Either way the guard has the
 * last word on legibility. Nothing here is persisted.
 */

export interface SourceImage {
	data: Uint8Array;
	mediaType: string;
}

type ResolvedModel = { provider: LlmProvider; modelId: string; model: ProviderModelResult };

/** Who the generation runs for: the project's model answers, and the user is charged in llm_inference. */
export interface GenerationScope {
	projectId: string;
	userId: string;
}

const FEW_COLORS = 4;
const SERIES_MIN_CHROMA = 0.1;
const IMAGE_APPROXIMATION_WARNING =
	'Read from an image: colours and shapes are sampled from pixels, so radii, font names and anything not visible are approximations.';
const SHELL_WARNING =
	'This looks like a document inside editor chrome. The theme follows the canvas, not the surrounding UI.';

export interface SourcePdf {
	fileName: string;
	pageCount: number;
	fromZip: boolean;
	pages: SourceImage[];
}

export interface StoryThemeSourceInput {
	url?: string;
	image?: SourceImage;
	imageName?: string;
	logo?: SourceImage & { fileName: string };
	zip?: { data: Uint8Array; fileName: string };
	pdfs?: SourcePdf[];
	instructions?: string;
	useWhiteLabel?: boolean;
}

export interface GeneratePairResult {
	theme: StoryThemePair;
	sourceMode: StoryThemeMode;
	notes: string[];
	generation: StoryThemeGeneration;
}

interface Brief {
	instructions?: string;
	whiteLabel: WhiteLabelBrand | null;
	uploadedLogo?: boolean;
	/** A site nao could not see properly (blocked, or read as bare stylesheets): the model recalls its brand. */
	recall?: { site: string; reason: string };
}

export async function generateStoryThemePairFromSources(
	scope: GenerationScope,
	input: StoryThemeSourceInput,
): Promise<GeneratePairResult> {
	const whiteLabel = input.useWhiteLabel === false ? null : await readWhiteLabelBrand();
	const uploadedLogo = input.logo
		? await toStoryLogo(Buffer.from(input.logo.data).toString('base64'), input.logo.mediaType)
		: null;
	const generated = await generateStoryThemeFromSources(scope, input, whiteLabel, uploadedLogo);
	const result = applyUploadedLogo(applyWhiteLabelIdentity(generated, whiteLabel), uploadedLogo);
	const sourceMode = storyThemeMode(result.theme);
	const derivedMode = oppositeStoryThemeMode(sourceMode);
	const theme = {
		[sourceMode]: result.theme,
		[derivedMode]: deriveStoryThemeVariant(result.theme, derivedMode),
	} as StoryThemePair;
	const notes = [
		...result.notes,
		`The source reads as ${sourceMode}, so the ${derivedMode} variant was derived from it: same accent, fonts and shapes on ${derivedMode} grounds.`,
	];
	return {
		theme,
		sourceMode,
		notes,
		generation: recordGeneration(input, whiteLabel, result, notes),
	};
}

/** Clipped to the stored schema, which the save route validates the record against. */
function recordGeneration(
	input: StoryThemeSourceInput,
	whiteLabel: WhiteLabelBrand | null,
	result: GenerateResult,
	notes: string[],
): StoryThemeGeneration {
	return {
		generatedAt: new Date().toISOString(),
		sources: describeSources(input, whiteLabel).slice(0, MAX_GENERATION_SOURCES),
		instructions: input.instructions?.trim() || undefined,
		rationale: result.rationale?.slice(0, MAX_GENERATION_TEXT_LENGTH),
		alert: result.alert?.slice(0, MAX_GENERATION_TEXT_LENGTH),
		notes: notes.slice(0, MAX_GENERATION_NOTES).map((note) => note.slice(0, MAX_GENERATION_TEXT_LENGTH)),
		editedByHand: false,
	};
}

/** The white-label logo and name are facts, not judgement: they go into the header as configured. */
function applyWhiteLabelIdentity(result: GenerateResult, whiteLabel: WhiteLabelBrand | null): GenerateResult {
	if (!whiteLabel) {
		return result;
	}
	const brand = { ...result.theme.brand };
	if (whiteLabel.logo) {
		brand.logo = whiteLabel.logo.dataUri;
	}
	if (!brand.name && whiteLabel.appName) {
		brand.name = whiteLabel.appName;
	}
	if (brand.header === 'none' && (brand.logo || brand.name)) {
		brand.header = brand.logo ? 'logo' : 'name';
	}
	return {
		...result,
		theme: { ...result.theme, brand: defaultIdentityHeader(brand) },
		notes: [...result.notes, ...describeWhiteLabelUse(whiteLabel)],
	};
}

/** An uploaded logo is the admin's explicit choice, so it wins over the white-label one. */
function applyUploadedLogo(result: GenerateResult, logo: StoryLogo | null): GenerateResult {
	if (!logo) {
		return result;
	}
	const brand = { ...result.theme.brand, logo: logo.dataUri };
	if (brand.header === 'none') {
		brand.header = 'logo';
	}
	return { ...result, theme: { ...result.theme, brand: defaultIdentityHeader(brand) } };
}

/** A logo outranks a bare name; whether the name also sits beside it stays the model's call, since a wordmark already spells it. */
function defaultIdentityHeader(brand: StoryTheme['brand']): StoryTheme['brand'] {
	const preferred =
		brand.logo && brand.header === 'name' ? { ...brand, header: 'logo' as const, showName: true } : brand;
	return normalizeBrandHeader(preferred);
}

function describeWhiteLabelUse(whiteLabel: WhiteLabelBrand): string[] {
	const used = [
		whiteLabel.appName ? `the name ${whiteLabel.appName}` : null,
		whiteLabel.brandColor ? `the primary colour ${whiteLabel.brandColor}` : null,
		whiteLabel.logo ? 'the logo' : null,
	].filter(Boolean);
	const note = `White-label branding was read as a source: ${used.join(', ')}.`;
	return whiteLabel.skippedLogoNote ? [note, whiteLabel.skippedLogoNote] : [note];
}

function describeSources(input: StoryThemeSourceInput, whiteLabel: WhiteLabelBrand | null): StoryThemeSourceRecord[] {
	const sources: StoryThemeSourceRecord[] = [];
	if (input.url) {
		sources.push({ kind: 'website', name: input.url.slice(0, MAX_SOURCE_NAME_LENGTH) });
	}
	if (input.image) {
		sources.push({
			kind: 'image',
			name: input.imageName ?? 'image',
			detail: describeBytes(input.image.data.byteLength),
		});
	}
	for (const pdf of input.pdfs ?? []) {
		sources.push({
			kind: 'pdf',
			name: pdf.fileName,
			detail: `${pdf.pages.length} of ${pdf.pageCount} pages read${pdf.fromZip ? ', from the ZIP' : ''}`,
		});
	}
	if (input.zip) {
		sources.push({ kind: 'zip', name: input.zip.fileName, detail: describeBytes(input.zip.data.byteLength) });
	}
	if (input.logo) {
		sources.push({ kind: 'logo', name: input.logo.fileName, detail: describeBytes(input.logo.data.byteLength) });
	}
	const instructions = input.instructions?.trim();
	if (instructions) {
		sources.push({ kind: 'instructions', name: instructions.slice(0, 120) });
	}
	if (whiteLabel) {
		sources.push({
			kind: 'white-label',
			name: whiteLabel.appName ?? 'White-label settings',
			detail: [whiteLabel.brandColor, whiteLabel.logo ? 'logo' : null].filter(Boolean).join(', ') || undefined,
		});
	}
	return sources;
}

function describeBytes(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${(bytes / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function generateStoryThemeFromSources(
	scope: GenerationScope,
	input: StoryThemeSourceInput,
	whiteLabel: WhiteLabelBrand | null,
	uploadedLogo: StoryLogo | null,
): Promise<GenerateResult> {
	const pdfs = input.pdfs ?? [];
	const instructions = input.instructions?.trim() || undefined;
	const brief: Brief = { instructions, whiteLabel, uploadedLogo: Boolean(uploadedLogo?.image) };
	const extraWarnings = pdfs.flatMap(describePdfCoverage);
	const visualImages = [...(input.image ? [input.image] : []), ...pdfs.flatMap((pdf) => pdf.pages)];
	const hasVisualSource = visualImages.length > 0;
	const zipWasOnlyPdfs = pdfs.some((pdf) => pdf.fromZip);
	const url = input.url;
	const zip = input.zip;
	const [urlOutcome, zipOutcome] = await Promise.allSettled([
		url ? extractSignalsFromUrl(url) : Promise.resolve(null),
		zip ? readZipSignals(zip) : Promise.resolve(null),
	]);

	const urlExtracted = urlOutcome.status === 'fulfilled' ? urlOutcome.value : null;
	const zipExtracted = zipOutcome.status === 'fulfilled' ? zipOutcome.value : null;
	const urlError = urlOutcome.status === 'rejected' ? urlOutcome.reason : null;
	const zipError = zipOutcome.status === 'rejected' ? zipOutcome.reason : null;

	const blockedSite = urlError instanceof SourceRefusedError && url ? siteName(url) : undefined;
	if (blockedSite) {
		brief.recall = { site: blockedSite, reason: 'it blocks automated visits' };
	}
	const unrendered = urlExtracted && url ? describeUnrenderedSite(url, urlExtracted) : undefined;
	if (unrendered && url) {
		brief.recall = {
			site: siteName(url),
			reason: 'the page could not be rendered, so nothing was measured: cards, buttons and radii are unknown',
		};
	}
	const redirected = urlExtracted?.redirectedTo && url ? describeRedirect(url, urlExtracted.redirectedTo) : undefined;
	const alert = redirected ?? unrendered;
	if (alert) {
		extraWarnings.push(alert);
	}
	if (urlError && !blockedSite && !zipExtracted && !hasVisualSource) {
		throw urlError;
	}
	if (zipError && !urlExtracted && !hasVisualSource) {
		throw zipError;
	}
	if (blockedSite) {
		extraWarnings.push(
			`${blockedSite} turned nao away (${describeError(urlError)}), so the model recalled the brand from what it knows. Add a screenshot of the site for exact colours.`,
		);
	} else if (urlError) {
		extraWarnings.push(
			`The website could not be read (${describeError(urlError)}). The theme is generated from the other sources.`,
		);
	}
	if (zipError && !zipWasOnlyPdfs) {
		extraWarnings.push(
			`The ZIP could not be read (${describeError(zipError)}). The theme is generated from the other sources.`,
		);
	}

	const parts: DesignSignals[] = [];
	const images: SourceImage[] = [...visualImages];
	if (urlExtracted?.screenshot) {
		images.push(urlExtracted.screenshot);
	}
	if (zipExtracted) {
		images.push(...zipExtracted.images);
	}
	const logoImage = uploadedLogo?.image ?? whiteLabel?.logo?.image;
	if (urlExtracted) {
		parts.push(urlExtracted.signals);
	}
	if (zipExtracted) {
		parts.push(zipExtracted.signals);
	}

	const brandImageSlots = logoImage ? MAX_SOURCE_IMAGES - 1 : MAX_SOURCE_IMAGES;
	const vision = logoImage ? [...images.slice(0, brandImageSlots), logoImage] : images.slice(0, brandImageSlots);
	if (images.length > brandImageSlots) {
		extraWarnings.push(
			`Only ${MAX_SOURCE_IMAGES} images can be read at once${logoImage ? ', the logo included' : ''}, so the last ${images.length - brandImageSlots} (after the image, the PDF pages, the website screenshot and then the ZIP images) were left out.`,
		);
	}
	if (parts.length === 0) {
		if (!hasVisualSource && !instructions && !whiteLabel && !brief.recall && !uploadedLogo) {
			throw new DesignSourceError('Add a website, an image, a PDF, a ZIP or instructions.');
		}
		if (!hasVisualSource) {
			const result = await generateStoryThemeFromBrief(scope, brief, logoImage ? [logoImage] : []);
			return { ...result, notes: [...extraWarnings, ...result.notes] };
		}
		const prompt = visualPrompt(Boolean(input.image), pdfs.length > 0);
		const result = await generateStoryThemeFromImages(scope, vision, prompt, brief);
		return { ...result, notes: [...extraWarnings, ...result.notes] };
	}

	if (input.image) {
		const ground = await detectGround(input.image).catch(() => null);
		if (ground?.shellDetected) {
			extraWarnings.push(SHELL_WARNING);
		}
	}

	const merged = mergeSignals(parts);
	const result = await generateStoryTheme(
		scope,
		{ ...merged, warnings: [...extraWarnings, ...merged.warnings] },
		vision,
		brief,
	);
	return { ...result, alert: result.alert ?? alert };
}

async function readZipSignals(zip: { data: Uint8Array; fileName: string }) {
	return extractSignalsFromZip(zip.data, zip.fileName);
}

function visualPrompt(hasImage: boolean, hasPdfPages: boolean): string {
	if (hasImage && hasPdfPages) {
		return MIXED_VISUAL_PROMPT;
	}
	return hasPdfPages ? PDF_PROMPT : IMAGE_PROMPT;
}

export async function generateStoryTheme(
	scope: GenerationScope,
	signals: DesignSignals,
	images: SourceImage[] = [],
	brief: Brief = { whiteLabel: null },
): Promise<GenerateResult> {
	const warnings = [...signals.warnings];
	const prompt = withBrief(renderSignals(signals), brief);
	const proposal = await proposeOrExplain(scope, prompt, images, warnings, {
		consequence: 'the theme was read directly from the strongest signals',
	});
	if (proposal) {
		return applyGuards(proposal, guardContext(signals, warnings, brief));
	}
	const modelFailure = warnings.at(-1);
	warnings.push(...describeUnappliedGuidance(brief));
	const grounded = await groundInImages(signals, images, warnings);
	return { ...applyGuards(fallbackProposal(grounded), guardContext(grounded, warnings)), alert: modelFailure };
}

/** The first image is sampled for pixels; every image goes to the model. */
export async function generateStoryThemeFromImages(
	scope: GenerationScope,
	images: SourceImage[],
	prompt = IMAGE_PROMPT,
	brief: Brief = { whiteLabel: null },
): Promise<GenerateResult> {
	const warnings = [IMAGE_APPROXIMATION_WARNING];
	let sample: ImageSample | null = null;
	let sampleError: unknown;
	try {
		sample = await sampleImage(images[0], 'image');
	} catch (error) {
		sampleError = error;
	}
	if (sample?.ground?.shellDetected) {
		warnings.push(SHELL_WARNING);
	}
	const proposal = await proposeOrExplain(scope, withBrief(prompt, brief), images, warnings, {
		consequence: 'its colours were sampled directly',
	});
	if (sample && proposal) {
		const snapped = await snapToImage(proposal, images[0], warnings, brief);
		return applyGuards(snapped, {
			...guardContext(sample.signals, warnings, brief),
			brandCandidates: declaredCandidates(brief),
			measuredSeries: [],
		});
	}
	if (sample) {
		const modelFailure = warnings.at(-1);
		warnings.push(...describeUnappliedGuidance(brief));
		const sampled = applyGuards(fallbackProposal(sample.signals), {
			...guardContext(sample.signals, warnings),
			measuredSeries: chromaticColors(sample.signals.brandCandidates),
		});
		return { ...sampled, alert: modelFailure };
	}
	if (proposal) {
		return applyGuards(proposal, { warnings });
	}
	throw new DesignSourceError(pixelSamplingUnavailable(sampleError));
}

/** Exact pixels beat the model's estimate for the fills it names (accent and chart colours), but never a colour the admin declared. */
async function snapToImage(
	proposal: ThemeProposal,
	image: SourceImage,
	warnings: string[],
	brief: Brief,
): Promise<ThemeProposal> {
	try {
		const named = [proposal.accent, ...proposal.series];
		const declared = declaredColors(brief);
		const snappable = named.filter((color) => !declared.has(normalizeColor(color) ?? color));
		const snappedByColor = new Map(
			(await snapToImageColors(image, snappable)).map((snapped, index) => [snappable[index], snapped]),
		);
		const snapped = named.map((color) => snappedByColor.get(color) ?? color);
		const [accent, ...series] = snapped;
		const moved = named.filter((color, index) => color !== snapped[index]);
		if (moved.length > 0) {
			warnings.push(
				`Matched ${moved.length} colour${moved.length === 1 ? '' : 's'} to the exact fills of the image.`,
			);
		}
		return { ...proposal, accent, series };
	} catch {
		return proposal;
	}
}

async function generateStoryThemeFromBrief(
	scope: GenerationScope,
	brief: Brief,
	images: SourceImage[],
): Promise<GenerateResult> {
	const warnings = brief.recall ? [] : [describeBriefOnly(brief)];
	const proposal = await proposeOrExplain(scope, withBrief(TEXT_PROMPT, brief), images, warnings, {
		consequence: 'no theme could be generated without a brand asset',
	});
	if (!proposal) {
		throw new DesignSourceError(
			warnings.at(-1) ?? 'Generating a theme without a brand asset needs a configured model.',
		);
	}
	return applyGuards(proposal, { warnings, steeredByAdmin: Boolean(brief.instructions) });
}

/** Asks the project's model for a proposal; explains in the warnings why it could not when it returns null. */
async function proposeOrExplain(
	scope: GenerationScope,
	prompt: string,
	images: SourceImage[],
	warnings: string[],
	{ consequence }: { consequence: string },
): Promise<ThemeProposal | null> {
	let model: ResolvedModel | null;
	try {
		model = await resolveModel(scope);
	} catch (error) {
		warnings.push(`The configured model could not be loaded (${describeError(error)}), so ${consequence}.`);
		return null;
	}
	if (!model) {
		warnings.push(`No model is configured for this project, so ${consequence}.`);
		return null;
	}
	try {
		return await proposeWithModel(scope, model, prompt, images);
	} catch (error) {
		warnings.push(`The configured model could not read the source (${describeError(error)}), so ${consequence}.`);
		return null;
	}
}

/**
 * Stylesheets may say little or nothing (a ZIP of logos and screenshots), so
 * the deterministic mapping borrows colours from the largest image when it has
 * too few to work with.
 */
async function groundInImages(
	signals: DesignSignals,
	images: SourceImage[],
	warnings: string[],
): Promise<DesignSignals> {
	const image = images[0];
	if (!image || signals.colors.length >= FEW_COLORS) {
		return signals;
	}
	try {
		const pixels = await sampleImage(image, signals.label);
		warnings.push(IMAGE_APPROXIMATION_WARNING);
		return mergePixelSignals(signals, pixels.signals);
	} catch (error) {
		if (signals.colors.length === 0) {
			throw new DesignSourceError(pixelSamplingUnavailable(error));
		}
		warnings.push(`The images in the ZIP could not be sampled (${describeError(error)}).`);
		return signals;
	}
}

/** A few greys in the CSS name no brand colour, so the image's candidates are kept until the CSS offers its own. */
function mergePixelSignals(signals: DesignSignals, pixels: DesignSignals): DesignSignals {
	const hasOwnColors = signals.colors.length > 0;
	return {
		...signals,
		colors: [...signals.colors, ...pixels.colors],
		brandCandidates: signals.brandCandidates.length > 0 ? signals.brandCandidates : pixels.brandCandidates,
		surfaces: hasOwnColors ? signals.surfaces : pixels.surfaces,
		prefersDarkGround: hasOwnColors ? signals.prefersDarkGround : pixels.prefersDarkGround,
	};
}

function describePdfCoverage(pdf: SourcePdf): string[] {
	if (pdf.pages.length >= pdf.pageCount) {
		return [];
	}
	return [`Read ${pdf.pages.length} of the ${pdf.pageCount} pages of ${pdf.fileName}, spread across the document.`];
}

/**
 * Pixels sampled from an image include photographs (a gold bottle, a brown
 * bag), so they never override the accent the model read from the chrome;
 * only the primary the admin declared in white-label does.
 */
function declaredCandidates(brief?: Brief): BrandCandidate[] {
	const declaredPrimary = brief?.whiteLabel?.brandColor;
	return declaredPrimary
		? [{ color: declaredPrimary, chroma: chromaOf(declaredPrimary), sources: ['white-label'] }]
		: [];
}

function declaredColors(brief: Brief): Set<string> {
	const written = brief.instructions?.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? [];
	const declared = [...written, brief.whiteLabel?.brandColor ?? ''].map(normalizeColor);
	return new Set(declared.filter((hex): hex is string => hex !== null));
}

function describeUnappliedGuidance(brief: Brief): string[] {
	return brief.instructions
		? [
				'The admin guidance needs the model to be read, so this theme does not follow it. Generate again once the model is available.',
			]
		: [];
}

function describeBriefOnly(brief: Brief): string {
	return brief.instructions
		? 'Generated from admin instructions only; no brand asset was read.'
		: 'Generated from the white-label settings only; no brand asset was read.';
}

/**
 * Without a browser nao reads bare stylesheets: no screenshot, no measured
 * card or button, so shapes and roles are unknown. The model recalls the brand
 * for what the stylesheets leave open, and the admin is told why.
 */
function describeUnrenderedSite(rawUrl: string, extracted: UrlSignals): string | undefined {
	if (!extracted.renderFailure) {
		return undefined;
	}
	return `${siteName(rawUrl)} could not be rendered (${extracted.renderFailure}), so only its stylesheets were read and the model filled the gaps from what it knows of the brand. Add a screenshot for exact colours and shapes.`;
}

function describeRedirect(rawUrl: string, landedOn: string): string {
	return `${siteName(rawUrl)} redirected to ${landedOn}, so the theme follows ${landedOn}. Check the address if that is not the brand.`;
}

function siteName(rawUrl: string): string {
	try {
		return bareHost(new URL(rawUrl).hostname);
	} catch {
		return rawUrl;
	}
}

function guardContext(signals: DesignSignals, warnings: string[], brief?: Brief): GuardContext {
	return {
		brandCandidates: [...declaredCandidates(brief), ...signals.brandCandidates],
		fontLinks: signals.fontLinks,
		warnings,
		steeredByAdmin: Boolean(brief?.instructions),
	};
}

function chromaticColors(candidates: BrandCandidate[]): string[] {
	return candidates.filter((candidate) => candidate.chroma >= SERIES_MIN_CHROMA).map((candidate) => candidate.color);
}

function pixelSamplingUnavailable(error: unknown): string {
	return `Reading an image needs either a configured model or a readable PNG, JPEG or WebP (${describeError(error)}).`;
}

const SYSTEM_PROMPT = [
	"You map a brand's design system onto a fixed dashboard theme contract. The goal is a report a person from",
	'the brand would mistake for one of their own pages: right grounds, right dominant colours, right type voice.',
	'Every colour is a 6-digit hex string like #1a2b3c.',
	'',
	'Precedence, strongest first:',
	'0. ADMIN GUIDANCE, when present — the admin states preferences (accent, light or dark ground, shapes,',
	'   typefaces, colours to avoid). They win over every source below. The sources still decide whatever the',
	'   guidance leaves open.',
	'0b. WHITE-LABEL BRANDING, when present — the name, primary colour and logo the admin already set for nao.',
	'1. ROLE EVIDENCE — measured from rendered elements. The primary button is the accent. The card is the',
	'   block background, its radius is the shape language, and whether it carries a border is the block border.',
	'2. An attached screenshot — what a person sees. Use it over colour frequency, and to confirm roles.',
	'   Do not override measured chrome.',
	'3. BRAND COLOUR CANDIDATES and other listed signals.',
	'4. ZIP tokens — typeface names and colours the page may not expose.',
	'PDF pages count as screenshots; when one prints swatches with hex codes or names typefaces, those printed',
	'values are the brand declaring its system and outrank colours sampled from photos.',
	'When several sources describe the same brand, reconcile them in that order.',
	'',
	'Major and minor colours: first decide which two or three colours carry the brand (the ones a visitor would',
	'name: Chanel is black, grey and beige on white; Perk is near-black and lime on cream; Brevo is deep green and',
	'pale green on white). Those are the major colours: they become the accent, the heading ink and the first',
	'chart series. Everything else is minor: surfaces, borders, muted text.',
	'',
	'Fields:',
	'- accent: the one the admin guidance names, if any. Otherwise the colour of the primary button or highlight.',
	'  When BRAND COLOUR CANDIDATES are listed, take the first unless it is plainly a status colour (error red,',
	'  success green). Black is a valid accent only for a black-and-white brand with no saturated highlight.',
	'- page: the ground the brand content sits on. A grey frame around a white document, an app shell, a slide',
	'  letterbox or a preview canvas is never the page. Prefer the brand white or cream over a grey unless the',
	'  brand itself is plainly grey.',
	'- blockBackground: the fill of cards and panels, read from the panels themselves, not the page around them.',
	'  Most product brands set rounded panels apart from the page by fill alone (white panels on a cream or grey',
	'  page, cream panels on a white page): then blockBackground differs from page even when the step is subtle.',
	'  Same as page only for editorial brands with no panels at all, that separate sections with rules. On a dark',
	'  page it is a slightly lifted dark, not white.',
	'- sunken: a recessed neutral one step further from the page than blockBackground. Empty string if none is visible.',
	'- headingColor, bodyColor, mutedColor: the text colours actually used, near-neutral. Never the accent.',
	'  mutedColor is one step quieter than bodyColor. Empty string if muted is not distinct.',
	'- headingFont and bodyFont: the families the page actually uses, in order, ending in a generic family.',
	'  Keep the brand face first even when it is marked unloadable. Read them from running text: headings,',
	'  navigation, buttons, paragraphs. Never from the logo or wordmark — that is custom lettering, and a serif',
	'  or display logo does not make the headings serif. When headings and body copy look like the same family,',
	'  give the same stack for both. From a screenshot with no font names, name the class you see with a system',
	'  stack: a neutral grotesque (Helvetica, Arial) is "\'Helvetica Neue\', Helvetica, Arial, sans-serif"; a',
	'  serif only when the running text itself has serifs.',
	'- headingFontSubstitute and bodyFontSubstitute: closest Google Fonts family by shape when the brand face',
	'  cannot be loaded; match width and weight, not just the class (neutral grotesque: Inter; narrow geometric:',
	'  Jost; wide geometric: Montserrat; humanist: Source Sans 3; high-contrast serif: Playfair Display).',
	'  Empty string when the face is already a Google Font or a system face, or when the stack is a system stack.',
	'- typography: the type voice of each kind of text, one line per role, in this exact form:',
	'    role: font weight case style tracking size',
	'  e.g. "display: body 400 uppercase normal 0.25 1.2". Give all eight lines. Read every role separately:',
	'  brands rarely set them alike (Chanel: a heavy wordmark, medium spaced capitals for navigation and titles,',
	'  plain sentence case for body copy). Roles: wordmark (the brand name in the header, styled like the logo',
	'  lettering), display (story title), heading (section headings), subheading',
	'  (chart and card titles), body (paragraphs, table cells), label (KPI names, legends, table headers, axis',
	'  ticks, eyebrows, navigation), button (buttons, filter chips, tabs), figure (KPI values).',
	'  font: heading or body — which of the two families above it uses.',
	"  weight: 300 to 800, judged from stroke thickness against the body copy, never from the brand's category:",
	'  strokes visibly thicker than body text are 600-800, about the same are 400-500, visibly thinner 300.',
	'  Spaced capitals in navigation are usually medium (500), and a logo is usually bold (700-800).',
	'  case: uppercase only where the brand sets that text in capitals; otherwise none.',
	'  style: italic only where the brand sets that text in italics; otherwise normal.',
	'  tracking: letter spacing in em, measured: usually -0.04 to 0.01, spaced capitals 0.08 to 0.25. Keep figure',
	'  at or below 0.02 so numbers keep their shape.',
	"  size: multiplier on nao's base size, 0.6 to 2; 1 unless the brand clearly sets that text larger or smaller.",
	'- blockRadius: radius of cards, panels and image tiles in px, read from those elements only. 0 is valid and',
	'  common. Pill buttons say nothing about cards: many brands pair pill buttons with square cards. Do not',
	'  default to 10 when the chrome is clearly rounder or squarer.',
	'- blockBorderWidth: 0 unless the brand visibly outlines its cards. Modern brands separate cards with fill',
	'  or space, not hairlines; never add a border just to delimit a block.',
	'- blockBorderColor and grid: structure — a neutral grey stepped off the block background, never a brand hue.',
	'- controlRadius: radius of the primary button in px; 999 for pill or stadium buttons.',
	'- kpiStyle: "lead" when the brand highlights one card by inverting it (a dark featured card with accent text);',
	'  "tinted" when it uses soft pastel cards in several hues; "plain" otherwise.',
	"- barRadius: corner radius of chart bars in px, read from the brand's own charts when the source shows any:",
	'  look at the bar ends themselves. Square bars are 0 even when cards and buttons are round, and most data',
	'  tools draw square bars: give 0 unless the ends are visibly rounded. -1 when no chart is visible, so the',
	'  bars follow the card geometry.',
	'- paletteSource: "brand" whenever you can name at least three colours from the brand, neutrals included.',
	'  "derive-from-accent" only when the brand shows a single colour and nothing else; then series may be empty.',
	"- series: when the source shows the brand's own charts, data viz, tags or illustrations in several hues, that",
	'  IS the palette: copy those hues exactly, as seen, in the order they appear, and set paletteSource "brand".',
	'  Hues that are close but distinct in the source (an indigo and a purple, two greens) are separate colours:',
	"  list each one. Do not add neutrals to a palette read from the brand's charts.",
	'  Otherwise, the chart palette in the order the brand uses its colours: the dominant major colour first, then',
	'  the second, then the highlight, then minor ones. Black, greys, creams and pale tints are valid series',
	'  colours when the brand uses them as major colours. Colours painted on the page come first, its neutrals',
	'  included (a warm grey, a beige); design tokens never seen on the page come last, if at all.',
	'  Give 4 to 6 colours. Never invent a hue the brand does',
	'  not show; with fewer than three brand colours, add neutrals stepped in lightness instead of new hues.',
	'  With admin guidance, give exactly six colours that follow it.',
	'- brandName: the brand name as its wordmark spells it, letter case included: a wordmark set in capitals is',
	'  written in capitals (HEX, CHANEL), a lowercase one in lowercase (perk). Empty when you cannot tell.',
	'- header: how the brand identity sits at the top of a story, apart from its title. "band" when the brand sets',
	'  its logo on a coloured bar (headerBackground is that colour), "logo" for a logo on the page above a rule,',
	'  "name" for the brand name on the page above a rule when there is no logo, "none" when there is no identity',
	'  to show.',
	'- headerBackground: the colour of the bar behind the logo, empty unless header is "band".',
	'- nameBesideLogo: true when the brand sets its name next to a symbol (a lockup), or the admin asks for it;',
	'  false when the logo is a wordmark that already spells the name.',
	'- rationale: one sentence naming the major colours and which source won for the accent and the radius.',
	'',
	'Do not:',
	'- Take a colour from a photograph (people, places, physical products). Product UI screenshots, charts and',
	'  diagrams the brand shows are its own design: read colours from them like any other chrome.',
	'- Invent a specific colour, typeface or radius when the source does not show one — use an empty string or a',
	'  near-neutral default.',
	'- Treat design-tool editor chrome as the brand. If the screenshot or source URL is Figma, FigJam, Sketch or',
	'  Framer, ignore dark sidebars, toolbars, layers and comment pins. page is the artboard fill. Hex codes',
	'  visible on the canvas are the chart palette; copy them into series. Fonts named like D7CBI are subset IDs,',
	'  not brand faces.',
].join('\n');

const PDF_PROMPT = [
	'These images are pages of a PDF: brand guidelines, a style guide or a slide deck. They are the only source.',
	'A page that prints swatches with hex codes or names its typefaces is the brand declaring its system: take',
	'those values over anything sampled from photos or illustrations. Slides show the brand in use: read the',
	'slide ground, title colour, highlight colour and card shapes from them.',
	'Where you cannot tell a colour, typeface or radius, use an empty string or a near-neutral default rather',
	'than inventing something specific.',
].join('\n');

const MIXED_VISUAL_PROMPT = [
	'The first image is a standalone source: a website screenshot, a slide, a style guide or a logo. The images',
	'after it are pages of a PDF: brand guidelines, a style guide or a slide deck. Together they are the only source.',
	'A page that prints swatches with hex codes or names its typefaces is the brand declaring its system: take',
	'those values over anything sampled from photos or illustrations. Otherwise sample colours you can actually',
	'see: the ground, the most prominent button or highlight, the heading colour, card grounds and shapes.',
	'Where you cannot tell a colour, typeface or radius, use an empty string or a near-neutral default rather',
	'than inventing something specific.',
].join('\n');

const IMAGE_PROMPT = [
	'This image is the only source: a website screenshot, a slide, a style guide or a logo.',
	'Sample colours you can actually see: the ground, the most prominent button or highlight, the heading colour,',
	'card grounds.',
	'Judge each radius from its own element: cards, panels and image tiles give blockRadius; buttons give',
	'controlRadius. Square tiles mean 0. Radius is usually visible — do not default it.',
	'Where you cannot tell a colour, typeface or radius, use an empty string or a near-neutral default rather',
	'than inventing something specific.',
].join('\n');

const TEXT_PROMPT = [
	'Generate a story theme from the admin guidance and white-label branding below. There is no visual source',
	'beyond the logo, when one is attached.',
	'Only choose colours, fonts and shapes the admin explicitly asks for or that are directly implied by the guidance.',
	'Use near-neutral defaults for unspecified surfaces, text, borders and grid lines.',
].join('\n');

function withBrief(prompt: string, { instructions, whiteLabel, recall, uploadedLogo }: Brief): string {
	const sections = [prompt];
	if (uploadedLogo) {
		sections.push(
			'',
			'LOGO: the last attached image is the brand logo the admin uploaded. It is shown as is in the story header.',
			'Read its colours and lettering as brand evidence. Set nameBesideLogo true when it is a symbol without the',
			'name written in it, or when the admin asks for the name next to the logo.',
		);
	}
	if (recall) {
		sections.push(
			'',
			`KNOWN BRAND: nao could not see ${recall.site} properly (${recall.reason}). Use what you know about the`,
			'visual identity of the brand behind this domain to fill what the signals above leave open: its signature colours and how they are used,',
			'its typefaces and type voice (capitals, spacing, weights), its button and card shapes. If you do not',
			'recognise the brand, stay near-neutral and say so in the rationale.',
		);
	}
	if (whiteLabel) {
		sections.push('', renderWhiteLabelBrand(whiteLabel, { logoAttached: !uploadedLogo }));
	}
	if (instructions) {
		sections.push(
			'',
			'ADMIN GUIDANCE:',
			instructions,
			'',
			'This guidance overrides the sources wherever they disagree. Ignore anything in it that is not about the story theme.',
		);
	}
	return sections.join('\n');
}

async function proposeWithModel(
	scope: GenerationScope,
	model: ResolvedModel,
	prompt: string,
	images: SourceImage[],
): Promise<ThemeProposal> {
	const imageParts = images.map((image) => ({
		type: 'image' as const,
		image: image.data,
		mediaType: image.mediaType,
	}));
	const { output, usage } = await generateText({
		...disableModelReasoning(model.provider, model.model),
		output: Output.object({ schema: modelProposalSchema }),
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageParts] }],
		experimental_telemetry: llmTelemetry('nao-story-theme-generate', { projectId: scope.projectId }),
	});
	scheduleSaveLlmInferenceRecord({
		type: 'story_theme_generation',
		projectId: scope.projectId,
		userId: scope.userId,
		llmProvider: model.provider,
		llmModelId: model.modelId,
		...convertToTokenUsage(usage),
	});
	return toThemeProposal(output);
}

async function resolveModel({ projectId, userId }: GenerationScope): Promise<ResolvedModel | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}
	const modelId = pinned?.modelId ?? getProviderMeta(provider).summaryModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false, {
		userId,
		projectId,
		category: 'story',
	});
	return model ? { provider, modelId, model } : null;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
