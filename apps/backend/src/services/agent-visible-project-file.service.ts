import {
	isRootRulesPath,
	renderConditionalGroupBlocksWithSourceLines,
	type RenderedConditionalGroupBlocks,
	type UserRulesGroupAccess,
} from '@nao/shared/rules-template';

import type { ToolContext } from '../types/tools';

export const isAgentVisibleRootRulesPath = isRootRulesPath;

export function renderProjectTextForAgent(
	virtualPath: string,
	source: string,
	context: Pick<ToolContext, 'userRulesGroupAccess'>,
): string | null {
	const rulesView = getAgentVisibleRulesView(virtualPath, source, context);
	return rulesView === undefined ? source : (rulesView?.content ?? null);
}

export function getAgentVisibleRulesView(
	virtualPath: string,
	source: string,
	context: Pick<ToolContext, 'userRulesGroupAccess'>,
): RenderedConditionalGroupBlocks | null | undefined {
	if (!isRootRulesPath(virtualPath)) {
		return undefined;
	}
	return renderRootRulesForAgent(source, context.userRulesGroupAccess);
}

export function renderRootRulesForAgent(
	source: string,
	access: UserRulesGroupAccess,
): RenderedConditionalGroupBlocks | null {
	try {
		return renderConditionalGroupBlocksWithSourceLines(source, access);
	} catch {
		return null;
	}
}
