import { useSyncExternalStore } from 'react';
import { Store } from './abstract-store';
import type { GroupProjectSharing, ProjectSharingSettings } from '@/lib/project-sharing-policy';
import { createLocalStorage } from '@/lib/local-storage';
import { DEFAULT_PROJECT_SHARING_SETTINGS, withGroupProjectSharing } from '@/lib/project-sharing-policy';

const storage = createLocalStorage<ProjectSharingSettings>(
	'nao:project-sharing-settings',
	DEFAULT_PROJECT_SHARING_SETTINGS,
);

/** Prototype-only persistence until the setting is stored on user groups by the backend. */
class ProjectSharingSettingsStore extends Store<ProjectSharingSettings> {
	protected state = storage.get();

	getSnapshot = () => this.state;

	setGroupProjectSharing = (group: { id: string; isDefault: boolean }, value: GroupProjectSharing) => {
		this.state = withGroupProjectSharing(this.state, group, value);
		storage.set(this.state);
		this.notify();
	};
}

export const projectSharingSettingsStore = new ProjectSharingSettingsStore();

export const useProjectSharingSettings = () =>
	useSyncExternalStore(projectSharingSettingsStore.subscribe, projectSharingSettingsStore.getSnapshot);
