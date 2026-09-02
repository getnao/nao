import path from 'node:path';

import type { DBContextRecommendation } from '../db/abstractSchema';
import type { ProposedEdit } from '../types/context-recommendation';

export function buildAgentPrompt(recs: DBContextRecommendation[], subPath: string): string {
	const header =
		recs.length === 1
			? 'Apply this context recommendation to improve the nao agent context:\n\n'
			: `Apply these ${recs.length} context recommendations to improve the nao agent context:\n\n`;

	const parts = recs.map((rec) => buildRecSection(rec, subPath));
	return header + parts.join('\n\n---\n\n');
}

function buildRecSection(rec: DBContextRecommendation, subPath: string): string {
	const lines: string[] = [
		`## ${rec.title}`,
		'',
		`**Summary:** ${rec.summary}`,
		'',
		`**Suggested action:** ${rec.suggestedAction}`,
	];

	if (rec.fixKind === 'patch' && rec.proposedEdits?.length) {
		lines.push('', '**File changes:**');
		for (const edit of rec.proposedEdits) {
			lines.push('', ...buildEditLines(edit, subPath));
		}
	} else if (rec.fixKind === 'manual') {
		if (rec.fixGuidance) {
			lines.push('', `**How to fix:** ${rec.fixGuidance}`);
		}
		if (rec.fixPrompt) {
			lines.push('', '**Prompt for your agent:**', '', rec.fixPrompt);
		}
	}

	return lines.join('\n');
}

function buildEditLines(edit: ProposedEdit, subPath: string): string[] {
	const filePath = editFilePath(edit, subPath);

	if (edit.kind === 'create') {
		const fence = fenceFor(edit.newContent);
		return [`### \`${filePath}\` (new file)`, fence, edit.newContent, fence];
	}

	const oldFence = fenceFor(edit.oldContent);
	const newFence = fenceFor(edit.newContent);
	return [
		`### \`${filePath}\``,
		'Find:',
		oldFence,
		edit.oldContent,
		oldFence,
		'Replace with:',
		newFence,
		edit.newContent,
		newFence,
	];
}

function editFilePath(edit: ProposedEdit, subPath: string): string {
	if (edit.targetRepo) {
		return `${edit.targetRepo.repoFullName}:${edit.targetRepo.path}`;
	}
	return subPath ? path.join(subPath, edit.path) : edit.path;
}

function fenceFor(content: string): string {
	const longestRun = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
	return '`'.repeat(Math.max(3, longestRun + 1));
}
