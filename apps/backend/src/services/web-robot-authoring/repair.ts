import type { WebRobotRecipe, WebRobotStage } from '@nao/shared/web-robot';

import { webRobotDefinitionHash } from '../web-scraper/definition';
import { authorWebRobotRecipeFromUrl } from './index';
import type { WebRobotAuthoringResult } from './types';

export type WebRobotRepairChange = {
	kind: 'source' | 'pagination' | 'extract' | 'fields' | 'identity' | 'limits';
	stageId?: string;
	message: string;
	before?: unknown;
	after?: unknown;
};

export type WebRobotRepairPreview = WebRobotAuthoringResult & {
	sourceUrl: string;
	currentDefinitionHash: string;
	proposedDefinitionHash?: string;
	changes: WebRobotRepairChange[];
};

export const previewWebRobotRepair = async (input: {
	projectId: string;
	currentRecipe: WebRobotRecipe;
	runRecipe?: WebRobotRecipe;
	env: Record<string, string>;
}): Promise<WebRobotRepairPreview> => {
	const sourceUrl = repairSourceUrl(input.runRecipe ?? input.currentRecipe);
	if (!sourceUrl) {
		throw new Error('The selected run does not contain a static catalogue URL to repair from.');
	}
	const authored = await authorWebRobotRecipeFromUrl({
		projectId: input.projectId,
		url: sourceUrl,
		env: input.env,
	});
	const recipe = 'recipe' in authored ? authored.recipe : undefined;
	return {
		...authored,
		sourceUrl,
		currentDefinitionHash: webRobotDefinitionHash(input.currentRecipe),
		...(recipe ? { proposedDefinitionHash: webRobotDefinitionHash(recipe) } : {}),
		changes: recipe ? recipeRepairChanges(input.currentRecipe, recipe) : [],
	};
};

export const repairSourceUrl = (recipe: WebRobotRecipe): string | undefined => {
	const source = recipe.stages[0]?.source;
	if (!source || source.url.includes('{{')) {
		return undefined;
	}
	return source.url;
};

export const recipeRepairChanges = (before: WebRobotRecipe, after: WebRobotRecipe): WebRobotRepairChange[] => {
	const changes: WebRobotRepairChange[] = [];
	for (const [index, stage] of after.stages.entries()) {
		const previous = before.stages[index];
		if (!previous) {
			changes.push({
				kind: 'extract',
				stageId: stage.id,
				message: `Stage '${stage.id}' was added.`,
			});
			continue;
		}
		changes.push(...stageRepairChanges(previous, stage));
	}
	for (const stage of before.stages.slice(after.stages.length)) {
		changes.push({ kind: 'extract', stageId: stage.id, message: `Stage '${stage.id}' was removed.` });
	}
	if (JSON.stringify(before.identity) !== JSON.stringify(after.identity)) {
		changes.push({
			kind: 'identity',
			message: 'Product identity fields changed.',
			before: before.identity,
			after: after.identity,
		});
	}
	if (JSON.stringify(before.limits) !== JSON.stringify(after.limits)) {
		changes.push({
			kind: 'limits',
			message: 'Execution limits changed.',
			before: before.limits,
			after: after.limits,
		});
	}
	return changes;
};

const stageRepairChanges = (before: WebRobotStage, after: WebRobotStage): WebRobotRepairChange[] => {
	const changes: WebRobotRepairChange[] = [];
	if (before.source.type !== after.source.type || before.source.url !== after.source.url) {
		changes.push({
			kind: 'source',
			stageId: after.id,
			message: `Stage '${after.id}' source changed.`,
			before: sourceSummary(before),
			after: sourceSummary(after),
		});
	}
	if (JSON.stringify(before.paginate) !== JSON.stringify(after.paginate)) {
		changes.push({
			kind: 'pagination',
			stageId: after.id,
			message: `Stage '${after.id}' pagination changed.`,
			before: before.paginate,
			after: after.paginate,
		});
	}
	if (before.extract?.type !== after.extract?.type) {
		changes.push({
			kind: 'extract',
			stageId: after.id,
			message: `Stage '${after.id}' extraction changed.`,
			before: before.extract?.type,
			after: after.extract?.type,
		});
	}
	if (before.extract?.type === 'dom' && after.extract?.type === 'dom') {
		if (before.extract.itemSelector !== after.extract.itemSelector) {
			changes.push({
				kind: 'extract',
				stageId: after.id,
				message: `Stage '${after.id}' item selector changed.`,
				before: before.extract.itemSelector,
				after: after.extract.itemSelector,
			});
		}
		const beforeFields = Object.keys(before.extract.fields).sort();
		const afterFields = Object.keys(after.extract.fields).sort();
		if (JSON.stringify(beforeFields) !== JSON.stringify(afterFields)) {
			changes.push({
				kind: 'fields',
				stageId: after.id,
				message: `Stage '${after.id}' extracted field set changed.`,
				before: beforeFields,
				after: afterFields,
			});
		}
	}
	return changes;
};

const sourceSummary = (stage: WebRobotStage): Record<string, unknown> => ({
	type: stage.source.type,
	url: stage.source.url,
	...('method' in stage.source ? { method: stage.source.method } : {}),
});
