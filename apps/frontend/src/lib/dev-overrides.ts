import { useSyncExternalStore } from 'react';

import { createLocalStorage } from '@/lib/local-storage';

export type DevOverride = 'default' | 'on' | 'off';

type DevOverridesSnapshot = Readonly<{
	license: DevOverride;
	cloud: DevOverride;
	panelExpanded: boolean;
}>;

const licenseStorage = createLocalStorage<DevOverride>('nao.dev-override.license', 'default');
const cloudStorage = createLocalStorage<DevOverride>('nao.dev-override.cloud', 'default');
const panelExpandedStorage = createLocalStorage<boolean>('nao.dev-override.panel-expanded', false);
const listeners = new Set<() => void>();
const defaultSnapshot: DevOverridesSnapshot = {
	license: 'default',
	cloud: 'default',
	panelExpanded: false,
};

let snapshot = readSnapshot();

export function useDevOverrides() {
	const currentSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	return {
		...currentSnapshot,
		setLicense: (value: DevOverride) => setOverride('license', value),
		setCloud: (value: DevOverride) => setOverride('cloud', value),
		setPanelExpanded,
	};
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): DevOverridesSnapshot {
	return import.meta.env.DEV ? snapshot : defaultSnapshot;
}

function getServerSnapshot(): DevOverridesSnapshot {
	return defaultSnapshot;
}

function readSnapshot(): DevOverridesSnapshot {
	if (!import.meta.env.DEV || typeof window === 'undefined') {
		return defaultSnapshot;
	}

	return {
		license: normalizeOverride(licenseStorage.get()),
		cloud: normalizeOverride(cloudStorage.get()),
		panelExpanded: panelExpandedStorage.get() === true,
	};
}

function normalizeOverride(value: DevOverride): DevOverride {
	return value === 'on' || value === 'off' ? value : 'default';
}

function setOverride(key: 'license' | 'cloud', value: DevOverride): void {
	if (!import.meta.env.DEV || snapshot[key] === value) {
		return;
	}

	if (key === 'license') {
		licenseStorage.set(value);
	} else {
		cloudStorage.set(value);
	}

	snapshot = { ...snapshot, [key]: value };
	emit();
}

function setPanelExpanded(value: boolean): void {
	if (!import.meta.env.DEV || snapshot.panelExpanded === value) {
		return;
	}

	panelExpandedStorage.set(value);
	snapshot = { ...snapshot, panelExpanded: value };
	emit();
}

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}
