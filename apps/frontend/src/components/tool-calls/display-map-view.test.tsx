// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapPoint } from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';
import type { ReactNode } from 'react';

import MapView from '@/components/tool-calls/display-map-view';

const { FakeMap, createdMaps } = vi.hoisted(() => {
	const maps: InstanceType<typeof FakeMapClass>[] = [];

	class FakeMapClass {
		camera = { center: { lng: 0, lat: 0 }, zoom: 0, bearing: 0, pitch: 0 };
		handlers = new Map<string, (() => void)[]>();
		jumpTo = vi.fn((camera: Partial<FakeMapClass['camera']>) => Object.assign(this.camera, camera));
		fitBounds = vi.fn();

		constructor() {
			maps.push(this);
		}

		on(event: string, layerOrHandler: string | (() => void), handler?: () => void) {
			const listener = typeof layerOrHandler === 'function' ? layerOrHandler : handler;
			if (listener) {
				this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
			}
		}

		emit(event: string) {
			this.handlers.get(event)?.forEach((listener) => listener());
		}

		getCenter() {
			return this.camera.center;
		}
		getZoom() {
			return this.camera.zoom;
		}
		getBearing() {
			return this.camera.bearing;
		}
		getPitch() {
			return this.camera.pitch;
		}
		getContainer() {
			return document.createElement('div');
		}
		getSource() {
			return undefined;
		}
		getLayer() {
			return undefined;
		}
		addControl() {}
		addSource() {}
		addLayer() {}
		remove() {}
	}

	return { FakeMap: FakeMapClass, createdMaps: maps };
});

vi.mock('@/lib/maplibre', () => ({
	maplibregl: { Map: FakeMap, NavigationControl: class {}, Popup: class {} },
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getMapBoundaries: {
				queryOptions: () => ({ queryKey: ['map-boundaries'], queryFn: () => new Promise(() => {}) }),
			},
		},
	},
}));

const CONFIG: displayMap.Input = {
	query_id: 'query',
	title: 'Stores',
	map_type: 'points',
	latitude_key: 'lat',
	longitude_key: 'lng',
};
const CHOROPLETH_CONFIG: displayMap.Input = {
	query_id: 'query',
	title: 'Regions',
	map_type: 'choropleth',
	region_boundaries: 'world_countries',
	region_key: 'country',
	value_key: 'sales',
};
const PARIS: MapPoint[] = [{ latitude: 48.85, longitude: 2.35, row: {} }];
const TOKYO: MapPoint[] = [{ latitude: 35.68, longitude: 139.69, row: {} }];

let setNearViewport: (isIntersecting: boolean) => void = () => {};

beforeEach(() => {
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
				setNearViewport = (isIntersecting) => act(() => callback([{ isIntersecting }]));
			}
			observe() {}
			disconnect() {}
		},
	);
});

afterEach(() => {
	cleanup();
	createdMaps.length = 0;
	vi.unstubAllGlobals();
});

describe('MapView camera across viewport releases', () => {
	it('restores the camera the user left when the map comes back', () => {
		renderMap(PARIS);
		setNearViewport(true);
		const firstMap = lastMap();
		act(() => firstMap.emit('style.load'));
		firstMap.camera = { center: { lng: 5, lat: 45 }, zoom: 9, bearing: 10, pitch: 20 };

		setNearViewport(false);
		setNearViewport(true);
		act(() => lastMap().emit('style.load'));

		expect(lastMap()).not.toBe(firstMap);
		expect(lastMap().jumpTo).toHaveBeenCalledWith(firstMap.camera);
		expect(lastMap().fitBounds).not.toHaveBeenCalled();
	});

	it('does not save the default camera of a map released before its style loaded', () => {
		renderMap(PARIS);
		setNearViewport(true);

		setNearViewport(false);
		setNearViewport(true);
		act(() => lastMap().emit('style.load'));

		expect(lastMap().jumpTo).not.toHaveBeenCalled();
		expect(lastMap().fitBounds).toHaveBeenCalledOnce();
	});

	it('fits the new data instead of restoring the camera when data changed off-screen', () => {
		const { rerender } = renderMap(PARIS);
		setNearViewport(true);
		act(() => lastMap().emit('style.load'));
		setNearViewport(false);

		rerender(<MapView points={TOKYO} rows={[]} config={CONFIG} customBoundaries={[]} />);
		setNearViewport(true);
		act(() => lastMap().emit('style.load'));

		expect(lastMap().jumpTo).not.toHaveBeenCalled();
		expect(lastMap().fitBounds).toHaveBeenCalledOnce();
	});

	it('restores the camera of a choropleth while its boundary sets are still loading', () => {
		renderWithQueryClient(<MapView points={[]} rows={[]} config={CHOROPLETH_CONFIG} />);
		setNearViewport(true);
		const firstMap = lastMap();
		act(() => firstMap.emit('style.load'));
		firstMap.camera = { center: { lng: 5, lat: 45 }, zoom: 9, bearing: 10, pitch: 20 };

		setNearViewport(false);
		setNearViewport(true);
		act(() => lastMap().emit('style.load'));

		expect(lastMap().jumpTo).toHaveBeenCalledWith(firstMap.camera);
	});
});

function renderMap(points: MapPoint[]) {
	return renderWithQueryClient(<MapView points={points} rows={[]} config={CONFIG} customBoundaries={[]} />);
}

function renderWithQueryClient(element: ReactNode) {
	const queryClient = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return render(element, { wrapper });
}

function lastMap() {
	return createdMaps[createdMaps.length - 1];
}
