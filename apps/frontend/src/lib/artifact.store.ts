import type { ArtifactVersion } from './artifact.utils';

type Listener = () => void;

const localVersions = new Map<string, ArtifactVersion[]>();
const listeners = new Set<Listener>();

function notify() {
	for (const listener of listeners) {
		listener();
	}
}

export function addLocalArtifactVersion(artifactId: string, version: ArtifactVersion) {
	const existing = localVersions.get(artifactId) ?? [];
	localVersions.set(artifactId, [...existing, version]);
	notify();
}

export function getLocalArtifactVersions(artifactId: string): ArtifactVersion[] {
	return localVersions.get(artifactId) ?? [];
}

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
