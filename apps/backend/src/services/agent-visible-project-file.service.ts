import {
	isRulesFilePath,
	renderConditionalGroupBlocksWithSourceLines,
	type RenderedConditionalGroupBlocks,
	type UserRulesGroupAccess,
} from '@nao/shared/rules-template';

import type { ToolContext } from '../types/tools';
import { extractRulesFile } from '../utils/nao-config';
import { renderColumnSecurityTableFile } from './column-security-context.service';

/** Tells the rules files apart, whose blocks gated by user group must be rendered before the agent reads them. */
export function createRulesPathMatcher(projectFolder: string): (virtualPath: string) => boolean {
	const rulesFile = extractRulesFile(projectFolder);
	return (virtualPath) => isRulesFilePath(virtualPath, rulesFile);
}

export function renderProjectTextForAgent(
	virtualPath: string,
	source: string,
	context: Pick<ToolContext, 'projectFolder' | 'userRulesGroupAccess' | 'warehouseColumnSecurity'>,
): string | null {
	const columnSecurityView = renderColumnSecurityTableFile(
		context.projectFolder,
		virtualPath,
		context.warehouseColumnSecurity,
	);
	if (columnSecurityView !== undefined) {
		return columnSecurityView;
	}
	if (!createRulesPathMatcher(context.projectFolder)(virtualPath)) {
		return source;
	}
	return renderRootRulesForAgent(source, context.userRulesGroupAccess)?.content ?? null;
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
