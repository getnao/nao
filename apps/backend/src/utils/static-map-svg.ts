import { computeMapBounds, type MapGeometry, MERCATOR_MAX_LATITUDE } from '@nao/shared';

export const VIEW_WIDTH = 852;
export const VIEW_HEIGHT = 568;
const PADDING = 12;
const DATA_BOUNDS_PAD_RATIO = 0.08;
const MIN_NORMALIZED_SPAN = 0.02;
const MIN_SEGMENT_PX = 0.7;
const BACKDROP_CHAR_BUDGET = 80_000;

type Point = [number, number];

export interface MapTip {
	label?: string;
	rows?: [string, string][];
}

export interface StaticMapRegion {
	d: string;
	fill: string;
	tip?: MapTip;
}

export interface StaticMapCircle {
	cx: number;
	cy: number;
	r: number;
	tip?: MapTip;
}

export interface StaticChoroplethSvg {
	viewBox: string;
	backdrop: string[];
	regions: StaticMapRegion[];
}

export interface StaticPointsSvg {
	viewBox: string;
	backdrop: string[];
	circles: StaticMapCircle[];
}

/** Builds inline-SVG geometry for a choropleth: a light backdrop plus one shaded path per region. */
export function buildChoroplethSvg(args: {
	regions: { geometry: MapGeometry; fill: string; tip?: MapTip }[];
	backdrop?: MapGeometry[];
}): StaticChoroplethSvg | null {
	const focus = collectPoints(args.regions.map((region) => region.geometry));
	if (focus.length === 0) {
		return null;
	}
	const fit = computeFit(focus);
	const regions = args.regions
		.map((region) => ({ d: geometryToPath(region.geometry, fit), fill: region.fill, tip: region.tip }))
		.filter((region) => region.d.length > 0);
	if (regions.length === 0) {
		return null;
	}
	return { viewBox: viewBox(), backdrop: backdropPaths(args.backdrop, fit), regions };
}

/** Builds inline-SVG geometry for a point/bubble map: a light backdrop plus one circle per point. */
export function buildPointsSvg(args: {
	points: { lng: number; lat: number; radius: number; tip?: MapTip }[];
	backdrop?: MapGeometry[];
}): StaticPointsSvg | null {
	if (args.points.length === 0) {
		return null;
	}
	const unwrapLng = longitudeUnwrapper(args.points.map((point) => point.lng));
	const focus = args.points.map((point) => project(unwrapLng(point.lng), point.lat));
	const fit = computeFit(focus);
	const circles = args.points.map((point) => {
		const [cx, cy] = toSvg(project(unwrapLng(point.lng), point.lat), fit);
		return { cx: round(cx), cy: round(cy), r: round(Math.max(1, point.radius)), tip: point.tip };
	});
	return { viewBox: viewBox(), backdrop: backdropPaths(args.backdrop, fit), circles };
}

function longitudeUnwrapper(longitudes: number[]): (lng: number) => number {
	const bounds = computeMapBounds(longitudes.map((longitude) => ({ latitude: 0, longitude, row: {} })));
	if (!bounds || bounds.east <= 180) {
		return (lng) => lng;
	}
	const { west } = bounds;
	return (lng) => (lng < west ? lng + 360 : lng);
}

export interface Fit {
	scale: number;
	offsetX: number;
	offsetY: number;
}

/** Projects lng/lat to normalized Web Mercator coords in [0,1] — the same scheme XYZ raster tiles use. */
export function project(lng: number, lat: number): Point {
	const clampedLat = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat));
	const x = (lng + 180) / 360;
	const sin = Math.sin((clampedLat * Math.PI) / 180);
	const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
	return [x, y];
}

const LEAFLET_COORD_DECIMALS = 2;

export function simplifyGeometry(geometry: MapGeometry): MapGeometry {
	if (geometry.type === 'Polygon') {
		return { type: 'Polygon', coordinates: simplifyRings(geometry.coordinates as Point[][]) };
	}
	if (geometry.type === 'MultiPolygon') {
		return {
			type: 'MultiPolygon',
			coordinates: (geometry.coordinates as Point[][][]).map((polygon) => simplifyRings(polygon)),
		};
	}
	return geometry;
}

function simplifyRings(rings: Point[][]): Point[][] {
	return rings.map((ring) => simplifyRing(ring));
}

function simplifyRing(ring: Point[]): Point[] {
	const factor = 10 ** LEAFLET_COORD_DECIMALS;
	const snap = (value: number) => Math.round(value * factor) / factor;
	const out: Point[] = [];
	let lastX: number | null = null;
	let lastY: number | null = null;
	for (const [lng, lat] of ring) {
		const x = snap(lng);
		const y = snap(lat);
		if (x === lastX && y === lastY) {
			continue;
		}
		out.push([x, y]);
		lastX = x;
		lastY = y;
	}
	return out.length >= 4 ? out : ring.map(([lng, lat]) => [snap(lng), snap(lat)] as Point);
}

function ringsOf(geometry: MapGeometry): Point[][] {
	if (geometry.type === 'Polygon') {
		return geometry.coordinates as Point[][];
	}
	if (geometry.type === 'MultiPolygon') {
		return (geometry.coordinates as Point[][][]).flat();
	}
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.flatMap((nested) => ringsOf(nested));
	}
	return [];
}

export function collectPoints(geometries: MapGeometry[]): Point[] {
	const points: Point[] = [];
	for (const geometry of geometries) {
		for (const ring of ringsOf(geometry)) {
			for (const [lng, lat] of ring) {
				points.push(project(lng, lat));
			}
		}
	}
	return points;
}

export function computeFit(points: Point[]): Fit {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const padX = Math.max((maxX - minX) * DATA_BOUNDS_PAD_RATIO, MIN_NORMALIZED_SPAN);
	const padY = Math.max((maxY - minY) * DATA_BOUNDS_PAD_RATIO, MIN_NORMALIZED_SPAN);
	minX -= padX;
	maxX += padX;
	minY -= padY;
	maxY += padY;
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	const innerWidth = VIEW_WIDTH - PADDING * 2;
	const innerHeight = VIEW_HEIGHT - PADDING * 2;
	const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
	const offsetX = PADDING + (innerWidth - spanX * scale) / 2 - minX * scale;
	const offsetY = PADDING + (innerHeight - spanY * scale) / 2 - minY * scale;
	return { scale, offsetX, offsetY };
}

export function toSvg([x, y]: Point, fit: Fit): Point {
	return [x * fit.scale + fit.offsetX, y * fit.scale + fit.offsetY];
}

function geometryToPath(geometry: MapGeometry, fit: Fit): string {
	return ringsOf(geometry)
		.map((ring) => ringToPath(ring, fit))
		.filter((segment) => segment.length > 0)
		.join(' ');
}

function ringToPath(ring: Point[], fit: Fit): string {
	if (ring.length < 3) {
		return '';
	}
	const commands: string[] = [];
	let lastX = 0;
	let lastY = 0;
	ring.forEach((coordinate, index) => {
		const [x, y] = toSvg(project(coordinate[0], coordinate[1]), fit);
		const isLast = index === ring.length - 1;
		if (index === 0) {
			commands.push(`M${roundCoord(x)},${roundCoord(y)}`);
			lastX = x;
			lastY = y;
			return;
		}
		if (!isLast && Math.abs(x - lastX) < MIN_SEGMENT_PX && Math.abs(y - lastY) < MIN_SEGMENT_PX) {
			return;
		}
		commands.push(`L${roundCoord(x)},${roundCoord(y)}`);
		lastX = x;
		lastY = y;
	});
	if (commands.length < 4) {
		return '';
	}
	return `${commands.join(' ')} Z`;
}

function backdropPaths(backdrop: MapGeometry[] | undefined, fit: Fit): string[] {
	if (!backdrop) {
		return [];
	}
	const paths = backdrop.map((geometry) => geometryToPath(geometry, fit)).filter((path) => path.length > 0);
	const total = paths.reduce((sum, path) => sum + path.length, 0);
	return total > BACKDROP_CHAR_BUDGET ? [] : paths;
}

function viewBox(): string {
	return `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function roundCoord(value: number): number {
	return Math.round(value);
}
