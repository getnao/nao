import { ALLOWED_GOOGLE_FONTS, DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import type { LlmProvider } from '@nao/shared/types';
import { generateObject } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import type { DesignSignals } from './story-theme-extract';
import { applyGuards, type InferenceResult, proposalSchema } from './story-theme-guard';

/**
 * Turn extracted design signals into a story theme.
 *
 * Two stages, and the order matters. The model does the part that needs
 * judgement - deciding which of forty candidate colours is the page ground and
 * which is the accent, whether a system is pill-shaped or square. Then the
 * deterministic guard fixes the part models are bad at: whether the resulting
 * chart palette is actually legible. The model never gets the last word on a
 * colour that has to encode data.
 */

const SYSTEM_PROMPT = [
	"You map a brand's design system onto a fixed dashboard theme contract.",
	'',
	'When the signals include ROLE EVIDENCE, trust it over colour frequency: it is',
	'measured from real rendered elements on the page. The primary button IS the',
	'accent. The card element IS the card surface, its radius IS the shape language,',
	'and whether it carries a border or a shadow IS the elevation. Do not average',
	'these away against a list of colours.',
	'',
	'Rules:',
	'- Every colour must be a 6-digit hex string like #1a2b3c.',
	'- accent = the primary button background. accent must not equal surfaces.card.',
	'- surfaces.page = the body/page ground. surfaces.card = the card ground.',
	'  If the page is dark, the card is usually a slightly lifted dark, not white.',
	'- shape.radius = the card radius in px. 0 is a valid, deliberate answer.',
	'- shape.controlShape: pill when the button radius is at least half its height,',
	'  square when it is 0 to 2px, otherwise rounded.',
	'- shape.elevation: shadowed when cards carry a shadow, bordered when they carry',
	'  a border, flat when they carry neither.',
	'- typography.headingFontSubstitute and bodyFontSubstitute: the nearest freely',
	'  loadable family, chosen ONLY from this list. Match by shape, not by name:',
	`  ${ALLOWED_GOOGLE_FONTS.join(', ')}.`,
	'- charts.grid and shape.border are structure, not data. Give them a neutral',
	'  grey stepped off the card surface, never a brand hue.',
	'- typography.headingFont and bodyFont: name the families the page actually uses,',
	'  in order, ending in a generic family. Keep the brand face first even when it is',
	'  marked unloadable, so the intent is recorded; put a close web-safe or Google',
	'  Fonts equivalent immediately after it as the real fallback.',
	'- typography.headingTracking is in em and is measured, not invented.',
	'- charts.series is a categorical palette for a dashboard. Spread it across',
	'  distinct hues, seeded from the brand palette. Never several tints of one hue:',
	'  they are unusable side by side in a chart.',
	'- charts.positive and charts.negative carry good/bad meaning and stay out of the',
	'  series. Only use a brand colour for them when the brand already uses it that way.',
	'- A marketing homepage is more expressive than a dashboard should be. Carry the',
	"  brand's colours, typefaces and shape language, but not hero-scale drama into a",
	'  tool someone reads every day. Keep typography.scale near 1.',
	'',
	'Answer with the object only.',
].join('\n');

export async function inferStoryTheme(projectId: string, signals: DesignSignals): Promise<InferenceResult> {
	const model = await resolveModel(projectId);
	if (!model) {
		return {
			theme: DEFAULT_STORY_THEME,
			notes: ['No language model is configured for this project, so the nao default theme was kept.'],
		};
	}

	const { object } = await generateObject({
		...disableModelReasoning(model.provider, model.model),
		schema: proposalSchema,
		system: SYSTEM_PROMPT,
		prompt: renderSignals(signals),
		experimental_telemetry: llmTelemetry('nao-story-theme-infer', { projectId }),
	});

	return applyGuards(object, signals, signals.probe?.fontLinks ?? []);
}

async function resolveModel(projectId: string): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}
	const modelId = pinned?.modelId ?? getProviderMeta(provider).summaryModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
}

export { applyGuards } from './story-theme-guard';

function renderSignals(signals: DesignSignals): string {
	const parts: string[] = [
		`Website: ${signals.url}`,
		signals.title ? `Page title: ${signals.title}` : '',
		`The page ground reads as ${signals.prefersDarkGround ? 'dark' : 'light'}.`,
		`Extraction mode: ${signals.mode}${signals.mode === 'static' ? ' (stylesheet text only, weaker signal)' : ' (computed styles from the rendered page)'}`,
		'',
	];

	if (signals.probe) {
		const { roles, surfaces, fonts } = signals.probe;
		parts.push('ROLE EVIDENCE, measured from rendered elements:');
		for (const [name, style] of Object.entries(roles)) {
			if (!style) {
				parts.push(`  ${name}: not found`);
				continue;
			}
			const bits = [
				style.background ? `bg ${style.background}` : null,
				style.color ? `text ${style.color}` : null,
				style.fontFamily ? `font ${style.fontFamily}` : null,
				style.fontSize ? `${style.fontSize}px` : null,
				style.fontWeight ? `w${style.fontWeight}` : null,
				style.letterSpacing ? `tracking ${style.letterSpacing}em` : null,
				style.borderRadius !== null ? `radius ${style.borderRadius}px` : null,
				style.hasBorder ? `border ${style.borderColor ?? 'yes'}` : null,
				style.hasShadow ? 'shadow' : null,
			].filter(Boolean);
			parts.push(`  ${name}: ${bits.join(', ')}${style.sample ? `  ("${style.sample}")` : ''}`);
		}
		parts.push('', 'Largest painted surfaces, most page area first:');
		parts.push(surfaces.map((s2) => `  ${s2.color}`).join('\n') || '  (none)');
		parts.push('', 'Font families the page loaded:');
		parts.push(
			fonts.map((f) => `  ${f.family}${f.loadable ? '' : '  (proprietary, nao cannot load it)'}`).join('\n') ||
				'  (none)',
		);
		parts.push('');
	}

	parts.push(
		'CSS custom properties resolved on the document root:',
		Object.entries(signals.customProperties)
			.slice(0, 40)
			.map(([k, v]) => `  ${k}: ${v}`)
			.join('\n') || '  (none declared)',
		'',
		signals.mode === 'rendered'
			? 'Colours weighted by how much of the page they actually paint:'
			: 'Most frequent colours, with the properties they appeared in:',
		signals.colors
			.slice(0, 24)
			.map((c) => `  ${c.hex}  [${c.properties.join(', ')}]`)
			.join('\n') || '  (none found)',
		'',
		'Border radius values in px, most used first:',
		signals.radii.map((r) => `  ${r.px}px  x${r.count}`).join('\n') || '  (none declared)',
	);

	return parts.filter((l) => l !== '').join('\n');
}

const SCREENSHOT_PROMPT = [
	'You are looking at a screenshot of a company website.',
	'',
	'Read its design system from the pixels and map it onto the dashboard theme',
	'contract. Sample colours you can actually see: the page ground, the colour of',
	'the most prominent button, the heading colour, the card grounds. Judge the',
	'corner radius of buttons and cards from their shape, and the typefaces from',
	'their letterforms (a high-contrast serif, a geometric sans, and so on).',
	'',
	'Be honest about uncertainty: where you cannot tell, choose the neutral option',
	'rather than inventing something specific.',
].join('\n');

/**
 * Infer from a screenshot instead of a URL.
 *
 * The escape hatch that does not require anything of the admin beyond what they
 * already have on screen. It reads less precisely than the rendered probe - no
 * measured radii, no real font names, no custom properties - so the model is
 * told to prefer neutral answers where the image is ambiguous, and the same
 * guard runs afterwards regardless.
 */
export async function inferStoryThemeFromImage(
	projectId: string,
	image: { data: string; mediaType: string },
	hint?: string,
): Promise<InferenceResult> {
	const model = await resolveModel(projectId);
	if (!model) {
		return {
			theme: DEFAULT_STORY_THEME,
			notes: ['No language model is configured for this project, so the nao default theme was kept.'],
		};
	}

	const { object } = await generateObject({
		...disableModelReasoning(model.provider, model.model),
		schema: proposalSchema,
		system: `${SYSTEM_PROMPT}\n\n${SCREENSHOT_PROMPT}`,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: hint ? `The site is ${hint}.` : 'Read the design system from this screenshot.',
					},
					{ type: 'image', image: Buffer.from(image.data, 'base64'), mediaType: image.mediaType },
				],
			},
		],
		experimental_telemetry: llmTelemetry('nao-story-theme-image', { projectId }),
	});

	const result = applyGuards(object, {
		warnings: [
			'Read from a screenshot. Colours and shapes are sampled from the image, so radii, font names and any colour not visible on screen are approximations.',
		],
	});
	return result;
}
