import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
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
	"You map a brand website's extracted design signals onto a fixed dashboard theme contract.",
	'',
	'Rules:',
	'- Every colour must be a 6-digit hex string like #1a2b3c.',
	'- Prefer colours that appeared as CSS custom properties: those are deliberate design decisions.',
	'- surfaces.page is the ground the site actually uses for content, not a hero section.',
	'- surfaces.card sits on top of page and is usually lighter (or darker on a dark site) by a small step.',
	'- ink.primary must be strongly readable on surfaces.card. Never pick a mid-grey for it.',
	'- charts.series is a categorical palette for a dashboard. Spread it across distinct hues.',
	'  Do not return several tints of one hue: they are unusable side by side in a chart.',
	'- charts.positive and charts.negative carry good/bad meaning and stay out of the series.',
	'- typography stacks must end in a generic family (serif, sans-serif, monospace).',
	'  Only name fonts that appeared in the signals, plus safe fallbacks.',
	'- shape.radius is in px. 0 is a valid, deliberate answer for a sharp-cornered brand.',
	"- A marketing homepage is more expressive than a dashboard should be. Carry the brand's",
	'  colours, typefaces and shape language, but do not carry hero-scale drama into a tool',
	'  someone reads every day.',
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

	return applyGuards(object, signals);
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
	const lines = [
		`Website: ${signals.url}`,
		signals.title ? `Page title: ${signals.title}` : null,
		`The site's own ground reads as ${signals.prefersDarkGround ? 'dark' : 'light'}.`,
		'',
		'CSS custom properties that resolve to colours (these are the strongest signal):',
		Object.entries(signals.customProperties)
			.slice(0, 40)
			.map(([k, v]) => `  ${k}: ${v}`)
			.join('\n') || '  (none declared)',
		'',
		'Most frequent colours, with the properties they appeared in:',
		signals.colors
			.slice(0, 28)
			.map((c) => `  ${c.hex}  x${c.count}  [${c.properties.join(', ')}]`)
			.join('\n') || '  (none found)',
		'',
		'Font stacks, most used first:',
		signals.fontFamilies.map((f) => `  ${f.stack}  x${f.count}`).join('\n') || '  (none declared)',
		'',
		'Border radius values in px, most used first:',
		signals.radii.map((r) => `  ${r.px}px  x${r.count}`).join('\n') || '  (none declared)',
	];
	return lines.filter((l) => l !== null).join('\n');
}
