import path from 'node:path';

import type { DBContextRecommendation } from '../db/abstractSchema';

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
			const filePath = edit.targetRepo
				? `${edit.targetRepo.repoFullName}:${edit.targetRepo.path}`
				: subPath
					? path.join(subPath, edit.path)
					: edit.path;
			lines.push('', `### \`${filePath}\``, '```', edit.newContent, '```');
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
