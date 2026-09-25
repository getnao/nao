import { MAX_SOURCE_IMAGES } from '@nao/shared/story-theme-source';
import type { LlmProvider } from '@nao/shared/types';
import { generateText, Output } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../../agents/providers';
import { llmTelemetry } from '../../agents/telemetry';
import * as llmConfigQueries from '../../queries/project-llm-config.queries';
import { resolveDefaultModelSelection, resolveProviderModel } from '../../utils/llm';
import { applyGuards, type GenerateResult, type GuardContext } from './guard';
import { detectGround, type ImageSample, sampleImage } from './pixels';
import { fallbackProposal, proposalSchema, renderSignals, type ThemeProposal } from './proposal';
import { type BrandCandidate, type DesignSignals, DesignSourceError, mergeSignals } from './signals';
import { extractSignalsFromUrl } from './url';
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

type ResolvedModel = { provider: LlmProvider; model: ProviderModelResult };

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
	zip?: { data: Uint8Array; fileName: string };
	pdfs?: SourcePdf[];
}

export async function generateStoryThemeFromSources(
	projectId: string,
	input: StoryThemeSourceInput,
): Promise<GenerateResult> {
	const pdfs = input.pdfs ?? [];
	const extraWarnings = pdfs.flatMap(describePdfCoverage);
	const visualImages = [...(input.image ? [input.image] : []), ...pdfs.flatMap((pdf) => pdf.pages)];
	const hasVisualSource = visualImages.length > 0;
	const zipWasOnlyPdfs = pdfs.some((pdf) => pdf.fromZip);
	const url = input.url;
	const zip = input.zip;
	const [urlOutcome, zipOutcome] = await Promise.allSettled([
		url ? extractSignalsFromUrl(url) : Promise.resolve(null),
		zip ? extractSignalsFromZip(zip.data, zip.fileName) : Promise.resolve(null),
	]);

	const urlExtracted = urlOutcome.status === 'fulfilled' ? urlOutcome.value : null;
	const zipExtracted = zipOutcome.status === 'fulfilled' ? zipOutcome.value : null;
	const urlError = urlOutcome.status === 'rejected' ? urlOutcome.reason : null;
	const zipError = zipOutcome.status === 'rejected' ? zipOutcome.reason : null;

	if (urlError && !zipExtracted && !hasVisualSource) {
		throw urlError;
	}
	if (zipError && !urlExtracted && !hasVisualSource) {
		throw zipError;
	}
	if (urlError) {
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
	if (urlExtracted) {
		parts.push(urlExtracted.signals);
	}
	if (zipExtracted) {
		parts.push(zipExtracted.signals);
	}

	const vision = images.slice(0, MAX_SOURCE_IMAGES);
	if (parts.length === 0) {
		if (!hasVisualSource) {
			throw new DesignSourceError('Add a website, an image, a PDF or a ZIP.');
		}
		const prompt = pdfs.length > 0 ? PDF_PROMPT : IMAGE_PROMPT;
		const result = await generateStoryThemeFromImages(projectId, vision, prompt);
		return { theme: result.theme, notes: [...extraWarnings, ...result.notes] };
	}

	if (input.image) {
		const ground = await detectGround(input.image).catch(() => null);
		if (ground?.shellDetected) {
			extraWarnings.push(SHELL_WARNING);
		}
	}

	const merged = mergeSignals(parts);
	return generateStoryTheme(projectId, { ...merged, warnings: [...extraWarnings, ...merged.warnings] }, vision);
}

export async function generateStoryTheme(
	projectId: string,
	signals: DesignSignals,
	images: SourceImage[] = [],
): Promise<GenerateResult> {
	const warnings = [...signals.warnings];
	const proposal = await proposeOrExplain(projectId, renderSignals(signals), images, warnings, {
		consequence: 'the theme was read directly from the strongest signals',
	});
	if (proposal) {
		return applyGuards(proposal, guardContext(signals, warnings));
	}
	const grounded = await groundInImages(signals, images, warnings);
	return applyGuards(fallbackProposal(grounded), guardContext(grounded, warnings));
}

/** The first image is sampled for pixels; every image goes to the model. */
export async function generateStoryThemeFromImages(
	projectId: string,
	images: SourceImage[],
	prompt = IMAGE_PROMPT,
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
	const proposal = await proposeOrExplain(projectId, prompt, images, warnings, {
		consequence: 'its colours were sampled directly',
	});
	if (sample) {
		return applyGuards(proposal ?? fallbackProposal(sample.signals), {
			...guardContext(sample.signals, warnings),
			measuredSeries: chromaticColors(sample.signals.brandCandidates),
		});
	}
	if (proposal) {
		return applyGuards(proposal, { warnings });
	}
	throw new DesignSourceError(pixelSamplingUnavailable(sampleError));
}

/** Asks the project's model for a proposal; explains in the warnings why it could not when it returns null. */
async function proposeOrExplain(
	projectId: string,
	prompt: string,
	images: SourceImage[],
	warnings: string[],
	{ consequence }: { consequence: string },
): Promise<ThemeProposal | null> {
	const model = await resolveModel(projectId);
	if (!model) {
		warnings.push(`No model is configured for this project, so ${consequence}.`);
		return null;
	}
	try {
		return await proposeWithModel(projectId, model, prompt, images);
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

function mergePixelSignals(signals: DesignSignals, pixels: DesignSignals): DesignSignals {
	const hasOwnColors = signals.colors.length > 0;
	return {
		...signals,
		colors: [...signals.colors, ...pixels.colors],
		brandCandidates: hasOwnColors ? signals.brandCandidates : pixels.brandCandidates,
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

function guardContext(signals: DesignSignals, warnings: string[]): GuardContext {
	return { brandCandidates: signals.brandCandidates, fontLinks: signals.fontLinks, warnings };
}

function chromaticColors(candidates: BrandCandidate[]): string[] {
	return candidates.filter((candidate) => candidate.chroma >= SERIES_MIN_CHROMA).map((candidate) => candidate.color);
}

function pixelSamplingUnavailable(error: unknown): string {
	return `Reading an image needs either a configured model or a readable PNG, JPEG or WebP (${describeError(error)}).`;
}

const SYSTEM_PROMPT = [
	"You map a brand's design system onto a fixed dashboard theme contract.",
	'Every colour is a 6-digit hex string like #1a2b3c.',
	'',
	'Precedence, strongest first:',
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
	'Fields:',
	'- accent: when BRAND COLOUR CANDIDATES are listed, take the first unless it is plainly a status colour',
	'  (error red, success green). Never pick black, white or grey as the accent when a saturated candidate exists.',
	'- page: the body ground.',
	'- blockBackground: cards and panels. On a dark page this is a slightly lifted dark, not white.',
	'- sunken: a recessed neutral one step further from the page than blockBackground. Empty string if none is visible.',
	'- headingColor, bodyColor, mutedColor: the text colours actually used, near-neutral. Never the accent.',
	'  mutedColor is one step quieter than bodyColor. Empty string if muted is not distinct.',
	'- headingFont and bodyFont: the families the page actually uses, in order, ending in a generic family.',
	'  Keep the brand face first even when it is marked unloadable.',
	'- headingFontSubstitute and bodyFontSubstitute: closest Google Fonts family by shape (geometric sans,',
	'  humanist sans, high-contrast serif, mono) when the brand face cannot be loaded. Empty string when the',
	'  face is already a Google Font or a system face.',
	'- headingTracking: in em, measured, usually between -0.04 and 0.01.',
	'- blockRadius: card radius in px. 0 is valid. Do not default to 10 when the chrome is clearly rounder or squarer.',
	'- blockBorderWidth: 0 or 1 unless the brand draws thick outlines.',
	'- blockBorderColor and grid: structure — a neutral grey stepped off the block background, never a brand hue.',
	'- barRadius: the same geometry at a smaller scale. 0 when cards are square. Do not leave it at 4 when',
	'  blockRadius is larger.',
	'- paletteSource: "brand" only when the source itself uses several distinct hues as UI (tags, chips, charts,',
	'  buttons). "derive-from-accent" when the brand is essentially monochrome; then series may be empty.',
	'- series: a categorical chart palette of distinct hues seeded from the brand, never several tints of one hue.',
	'- rationale: one sentence naming which source won for the accent and the radius. Not a field-by-field dump.',
	'',
	'Do not:',
	'- Take a colour from a photograph or product shot. Read only chrome: grounds, text, buttons, borders, tags.',
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

const IMAGE_PROMPT = [
	'This image is the only source: a website screenshot, a slide, a style guide or a logo.',
	'Sample colours you can actually see: the ground, the most prominent button or highlight, the heading colour,',
	'card grounds.',
	'Judge corner radius from visible chrome (cards, buttons, inputs, rounded images). Pill or stadium buttons',
	'mean a soft brand (blockRadius 14–18). Square tiles mean 0. Radius is usually visible — do not default it.',
	'Where you cannot tell a colour, typeface or radius, use an empty string or a near-neutral default rather',
	'than inventing something specific.',
].join('\n');

async function proposeWithModel(
	projectId: string,
	model: ResolvedModel,
	prompt: string,
	images: SourceImage[],
): Promise<ThemeProposal> {
	const imageParts = images.map((image) => ({
		type: 'image' as const,
		image: image.data,
		mediaType: image.mediaType,
	}));
	const { output } = await generateText({
		...disableModelReasoning(model.provider, model.model),
		output: Output.object({ schema: proposalSchema }),
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageParts] }],
		experimental_telemetry: llmTelemetry('nao-story-theme-generate', { projectId }),
	});
	return output;
}

async function resolveModel(projectId: string): Promise<ResolvedModel | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}
	const modelId = pinned?.modelId ?? getProviderMeta(provider).summaryModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
