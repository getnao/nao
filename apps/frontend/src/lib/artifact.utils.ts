import { getLocalArtifactVersions } from './artifact.store';
import type { UIMessage } from '@nao/backend/chat';
import type { artifact } from '@nao/shared/tools';

export interface ArtifactVersion {
	version: number;
	code: string;
	title: string;
	action: artifact.Input['action'];
}

/**
 * Scans all messages in a conversation and collects the ordered version history
 * for a given artifact id, including any local (client-side) versions.
 */
export function collectArtifactVersions(messages: UIMessage[], artifactId: string): ArtifactVersion[] {
	const versions: ArtifactVersion[] = [];

	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type !== 'tool-artifact') {
				continue;
			}

			const output = part.output;
			const input = part.input;

			if (!output?.success || output.id !== artifactId || !input?.action) {
				continue;
			}

			versions.push({
				version: output.version,
				code: output.code,
				title: output.title,
				action: input.action,
			});
		}
	}

	const local = getLocalArtifactVersions(artifactId);
	versions.push(...local);

	return versions;
}

export interface ArtifactSummary {
	id: string;
	title: string;
}

/**
 * Finds all distinct artifact ids across all messages in a conversation.
 */
export function findArtifactIds(messages: UIMessage[]): string[] {
	return findArtifacts(messages).map((a) => a.id);
}

/**
 * Finds all distinct artifacts (id + latest title) across all messages.
 */
export function findArtifacts(messages: UIMessage[]): ArtifactSummary[] {
	const seen = new Map<string, string>();

	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type !== 'tool-artifact') {
				continue;
			}

			const output = part.output;
			if (output?.success && output.id) {
				seen.set(output.id, output.title);
			}
		}
	}

	return [...seen.entries()].map(([id, title]) => ({ id, title }));
}
