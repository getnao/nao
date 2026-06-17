import fs from 'node:fs';

import { z } from 'zod';

import { fingerprintFor } from '../../services/context-recommendations.reconcile';
import { ContextRecommendationFixKind, LinkedContextRepo, ProposedEdit } from '../../types/context-recommendation';
import { isHumanWritableContextPath, normalizeContextPath } from '../../utils/nao-context-paths';
import { createTool, toRealPath } from '../../utils/tools';

const SubjectSchema = {
	suggestedFile: z.string().describe('The `suggestedFile` of the recommendation this fix belongs to.'),
	subjectKey: z.string().describe('The `subjectKey` of the recommendation this fix belongs to.'),
};

const EditSchema = z.object({
	...SubjectSchema,
	path: z
		.string()
		.describe('Project-relative path of the human-written file to edit (e.g. RULES.md, semantics/orders.md).'),
	old_string: z
		.string()
		.optional()
		.describe(
			'Exact text to replace. Omit to create a new file or replace the whole file — then `new_string` is the full content.',
		),
	new_string: z.string().describe('Replacement text, or the full file content when `old_string` is omitted.'),
});
type EditInput = z.infer<typeof EditSchema>;

const ManualFixSchema = z.object({
	...SubjectSchema,
	guidance: z
		.string()
		.describe('Plain-language explanation of what must change and why it cannot be edited automatically.'),
	prompt: z
		.string()
		.describe('A ready-to-paste prompt the user can give to their own coding LLM to apply the fix themselves.'),
});
type ManualFixInput = z.infer<typeof ManualFixSchema>;

type Ack = { _version: '1'; ok: true };

interface CollectedFix {
	edits: ProposedEdit[];
	manual?: { guidance: string; prompt: string };
}

export interface PersistedFix {
	fixKind: ContextRecommendationFixKind;
	proposedEdits: ProposedEdit[] | null;
	fixGuidance: string | null;
	fixPrompt: string | null;
}

export interface ContextFixCollector {
	editTool: ReturnType<typeof createTool<EditInput, Ack>>;
	manualFixTool: ReturnType<typeof createTool<ManualFixInput, Ack>>;
	/** Returns the persistable fix for a recommendation fingerprint, or null if none was proposed. */
	getFix: (fingerprint: string) => PersistedFix | null;
}

interface ContextFixCollectorOptions {
	allowContextEdits?: boolean;
}

/**
 * Collects the concrete fixes an analysis agent proposes for each recommendation.
 *
 * - `edit_file` accumulates per-file edits into full before/after contents, keeping a
 *   diff the UI can render and a payload the PR builder can write verbatim. Edits to
 *   auto-generated files are rejected so a sync never clobbers the change.
 * - `propose_manual_fix` records human guidance plus a ready-to-paste LLM prompt for
 *   the cases where the fix belongs in a generated file or at the source.
 */
export function createContextFixCollector(
	projectFolder: string,
	linkedRepos: LinkedContextRepo[] = [],
	options: ContextFixCollectorOptions = {},
): ContextFixCollector {
	const fixes = new Map<string, CollectedFix>();
	const allowContextEdits = options.allowContextEdits ?? true;

	const getOrCreate = (suggestedFile: string, subjectKey: string): CollectedFix => {
		const fingerprint = fingerprintFor(suggestedFile, subjectKey);
		const existing = fixes.get(fingerprint);
		if (existing) {
			return existing;
		}
		const created: CollectedFix = { edits: [] };
		fixes.set(fingerprint, created);
		return created;
	};

	const editTool = createTool<EditInput, Ack>({
		description:
			'Propose a concrete edit to a human-written context file (RULES.md, semantics/**, docs/**, queries/**, ' +
			'nao_config.yaml, agent/**) or a linked GitHub repo file under repos/<name>/** to fix a recommendation ' +
			'you just recorded. Never target generated warehouse files (databases/**) or unlinked repos/** paths — use ' +
			'propose_manual_fix for those. Call once per logical change; multiple edits to the same file are merged.',
		inputSchema: EditSchema,
		execute: async ({ suggestedFile, subjectKey, path: filePath, old_string, new_string }) => {
			const target = resolveEditTarget(filePath, linkedRepos, allowContextEdits);

			const fix = getOrCreate(suggestedFile, subjectKey);
			const pending = fix.edits.find((edit) => edit.path === filePath);
			const original = pending ? pending.oldContent : readFileSafe(filePath, projectFolder);
			const fileExists = pending ? pending.kind === 'edit' : original !== null;
			const baseContent = pending ? pending.newContent : (original ?? '');

			const nextContent = applyEdit(baseContent, old_string, new_string, filePath);

			const proposed: ProposedEdit = {
				path: filePath,
				kind: fileExists ? 'edit' : 'create',
				oldContent: original ?? '',
				newContent: nextContent,
				...target,
			};
			if (pending) {
				Object.assign(pending, proposed);
			} else {
				fix.edits.push(proposed);
			}
			return { _version: '1', ok: true };
		},
	});

	const manualFixTool = createTool<ManualFixInput, Ack>({
		description:
			'Record a manual fix for a recommendation whose target file is auto-generated (databases/**), belongs to ' +
			'an unlinked repos/** source, or lives outside a GitHub repo. Provide guidance and a ready-to-paste prompt ' +
			"for the user's own coding LLM. Use this instead of edit_file when no PR-capable file can carry the change.",
		inputSchema: ManualFixSchema,
		execute: async ({ suggestedFile, subjectKey, guidance, prompt }) => {
			const fix = getOrCreate(suggestedFile, subjectKey);
			fix.manual = { guidance, prompt };
			return { _version: '1', ok: true };
		},
	});

	const getFix = (fingerprint: string): PersistedFix | null => {
		const fix = fixes.get(fingerprint);
		if (!fix) {
			return null;
		}
		if (fix.edits.length > 0) {
			return { fixKind: 'patch', proposedEdits: fix.edits, fixGuidance: null, fixPrompt: null };
		}
		if (fix.manual) {
			return {
				fixKind: 'manual',
				proposedEdits: null,
				fixGuidance: fix.manual.guidance,
				fixPrompt: fix.manual.prompt,
			};
		}
		return null;
	};

	return { editTool, manualFixTool, getFix };
}

function resolveEditTarget(
	filePath: string,
	linkedRepos: LinkedContextRepo[],
	allowContextEdits: boolean,
): Pick<ProposedEdit, 'targetRepo'> {
	const normalized = normalizeContextPath(filePath);
	if (hasTraversalSegment(normalized)) {
		throw new Error(`"${filePath}" contains a path traversal segment ("..") and cannot be edited.`);
	}

	if (isHumanWritableContextPath(filePath)) {
		if (!allowContextEdits) {
			throw new Error(
				`"${filePath}" belongs to the context repository, but no GitHub repository is configured for context PRs. ` +
					'Call propose_manual_fix unless this finding belongs in a linked GitHub repo under repos/<name>/**.',
			);
		}
		return {};
	}

	const linkedRepo = linkedRepos.find((repo) => normalized.startsWith(`${normalizeContextPath(repo.contextPath)}/`));
	if (!linkedRepo) {
		throw new Error(
			`"${filePath}" is auto-generated by \`nao sync\` and would be overwritten. ` +
				'Encode the fix in a human-written file (RULES.md or semantics/**) or call propose_manual_fix instead.',
		);
	}
	if (!linkedRepo.repoFullName) {
		throw new Error(
			`"${filePath}" belongs to "${linkedRepo.contextPath}", which is not linked to a GitHub repository. ` +
				'Call propose_manual_fix with guidance for the upstream source instead.',
		);
	}

	const targetPath = normalized.slice(`${normalizeContextPath(linkedRepo.contextPath)}/`.length);
	if (!targetPath) {
		throw new Error(`"${filePath}" points at a repository folder, not a file.`);
	}

	return {
		targetRepo: {
			repoFullName: linkedRepo.repoFullName,
			branch: linkedRepo.branch,
			path: targetPath,
		},
	};
}

function hasTraversalSegment(normalizedPath: string): boolean {
	return normalizedPath.split('/').includes('..');
}

function readFileSafe(filePath: string, projectFolder: string): string | null {
	try {
		return fs.readFileSync(toRealPath(filePath, projectFolder), 'utf-8');
	} catch {
		return null;
	}
}

function applyEdit(base: string, oldString: string | undefined, newString: string, filePath: string): string {
	if (oldString === undefined || oldString === '') {
		return newString;
	}
	const index = base.indexOf(oldString);
	if (index === -1) {
		throw new Error(`old_string was not found in "${filePath}". Read the file first and copy the exact text.`);
	}
	if (base.indexOf(oldString, index + oldString.length) !== -1) {
		throw new Error(
			`old_string is not unique in "${filePath}". Include more surrounding context so it matches exactly once.`,
		);
	}
	return base.slice(0, index) + newString + base.slice(index + oldString.length);
}
