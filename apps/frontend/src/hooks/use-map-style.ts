import { useSyncExternalStore } from 'react';

import { createLocalStorage } from '@/lib/local-storage';

export type MapStyleId = 'auto' | 'positron' | 'bright' | 'liberty' | 'fiord' | 'dark';

const OPENFREEMAP_STYLES = 'https://tiles.openfreemap.org/styles';

export const MAP_STYLE_LIGHT = import.meta.env.VITE_MAP_STYLE_URL || `${OPENFREEMAP_STYLES}/positron`;
export const MAP_STYLE_DARK = import.meta.env.VITE_MAP_STYLE_URL_DARK || `${OPENFREEMAP_STYLES}/dark`;

export interface MapStyleOption {
	id: MapStyleId;
	label: string;
	url?: string;
	dark?: boolean;
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
	{ id: 'auto', label: 'Automatic' },
	{ id: 'positron', label: 'Positron', url: `${OPENFREEMAP_STYLES}/positron` },
	{ id: 'bright', label: 'Bright', url: `${OPENFREEMAP_STYLES}/bright` },
	{ id: 'liberty', label: 'Liberty', url: `${OPENFREEMAP_STYLES}/liberty` },
	{ id: 'fiord', label: 'Fiord', url: `${OPENFREEMAP_STYLES}/fiord`, dark: true },
	{ id: 'dark', label: 'Dark', url: `${OPENFREEMAP_STYLES}/dark`, dark: true },
];

const MAP_STYLE_STORAGE_KEY = 'nao:map-style';
const storage = createLocalStorage<MapStyleId>(MAP_STYLE_STORAGE_KEY, 'auto');
const listeners = new Set<() => void>();
let current = normalize(storage.get());

function normalize(value: MapStyleId | null): MapStyleId {
	return MAP_STYLE_OPTIONS.some((option) => option.id === value) ? (value as MapStyleId) : 'auto';
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key !== null && event.key !== MAP_STYLE_STORAGE_KEY) {
			return;
		}
		const next = normalize(storage.get());
		if (next === current) {
			return;
		}
		current = next;
		for (const listener of listeners) {
			listener();
		}
	});
}

export function getMapStyle(): MapStyleId {
	return current;
}

export function setMapStyle(styleId: MapStyleId) {
	if (styleId === current) {
		return;
	}
	current = styleId;
	storage.set(styleId);
	for (const listener of listeners) {
		listener();
	}
}

export function useMapStyle() {
	const styleId = useSyncExternalStore(subscribe, getMapStyle);
	return [styleId, setMapStyle] as const;
}

export function resolveStyleUrl(styleId: MapStyleId, isDark: boolean): string {
	if (styleId === 'auto') {
		return isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
	}
	return MAP_STYLE_OPTIONS.find((option) => option.id === styleId)?.url ?? MAP_STYLE_LIGHT;
}

export function isMapStyleDark(styleId: MapStyleId, appIsDark: boolean): boolean {
	if (styleId === 'auto') {
		return appIsDark;
	}
	return MAP_STYLE_OPTIONS.find((option) => option.id === styleId)?.dark ?? false;
}
