import {
	BUBBLE_MAX_RADIUS,
	buildMapPoints,
	computeMapBounds,
	DEFAULT_MARKER_COLOR,
	DEFAULT_MARKER_RADIUS,
	MAX_MAP_POINTS,
	numericDomain,
	parseNumericValue,
	resolveColumnName,
	scaleBubbleRadius,
} from '@nao/shared/map';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet';
import { Block, BlockState } from './block';
import { isNumericColumn } from './columns';
import { formatNumber } from './format';
import { MapTiles } from './map-tiles';
import { useBlockData } from './use-block-data';
import type { MapBounds, MapPoint } from '@nao/shared/map';
import type { LatLngBoundsExpression } from 'leaflet';
import type { ReactNode } from 'react';
import type { BlockProps } from './block';
import type { Row } from './columns';
import type { BlockDataSource } from './use-block-data';

export interface PointMapProps extends BlockProps, BlockDataSource {
	latitudeKey?: string;
	longitudeKey?: string;
	sizeKey?: string;
	labelKey?: string;
	tooltipKeys?: string[];
	color?: string;
	radius?: number;
	height?: number | string;
	children?: ReactNode;
}

const LATITUDE_COLUMN = /^(lat|latitude|y)$|_lat(itude)?$|^lat_/i;
const LONGITUDE_COLUMN = /^(lng|lon|long|longitude|x)$|_(lng|lon|long|longitude)$|^(lng|lon|long)_/i;
const BOUNDS_PADDING_PX = 24;

export function PointMap(props: PointMapProps) {
	const {
		queryId,
		data,
		latitudeKey,
		longitudeKey,
		sizeKey,
		labelKey,
		tooltipKeys,
		color = DEFAULT_MARKER_COLOR,
		radius = DEFAULT_MARKER_RADIUS,
		height,
		children,
		style,
		...block
	} = props;
	const source = useBlockData({ queryId, data });

	return (
		<Block kind='point-map' queryId={queryId} style={style} {...block}>
			<BlockState data={source} emptyMessage='No rows to place on the map.'>
				{(rows, columns) => {
					const keys = resolveKeys(rows, columns, { latitudeKey, longitudeKey, sizeKey, labelKey });
					if (!keys) {
						return (
							<div className='nao-block__state nao-block__state--error' role='alert'>
								No latitude/longitude columns among {columns.join(', ')}: pass latitudeKey and
								longitudeKey.
							</div>
						);
					}
					const points = buildMapPoints(rows, {
						latitude_key: keys.latitudeKey,
						longitude_key: keys.longitudeKey,
					}).slice(0, MAX_MAP_POINTS);
					const bounds = computeMapBounds(points);
					if (!bounds) {
						return <div className='nao-block__state'>No rows with valid coordinates.</div>;
					}
					const sizes = keys.sizeKey
						? points.map((point) => parseNumericValue(point.row[keys.sizeKey!]))
						: null;
					const sizeDomain = sizes ? numericDomain(sizes) : null;
					const detailKeys = tooltipKeys ?? defaultTooltipKeys(keys);
					return (
						<div className='nao-map' style={height === undefined ? undefined : { height }}>
							<MapContainer bounds={toLeafletBounds(bounds)} scrollWheelZoom={false}>
								<MapTiles />
								<FitPoints bounds={bounds} />
								{points.map((point, index) => (
									<CircleMarker
										key={index}
										center={[point.latitude, point.longitude]}
										radius={
											sizes
												? scaleBubbleRadius(sizes[index], sizeDomain, BUBBLE_MAX_RADIUS)
												: radius
										}
										pathOptions={{ color, fillColor: color, fillOpacity: 0.55, weight: 1 }}
									>
										<Tooltip>
											<PointDetails
												point={point}
												labelKey={keys.labelKey}
												detailKeys={detailKeys}
											/>
										</Tooltip>
									</CircleMarker>
								))}
								{children}
							</MapContainer>
						</div>
					);
				}}
			</BlockState>
		</Block>
	);
}

/** Frames the points on mount and again whenever the map is resized, which Leaflet never does by itself. */
function FitPoints({ bounds }: { bounds: MapBounds }) {
	const map = useMap();
	const { west, south, east, north } = bounds;
	useEffect(() => {
		const fit = (): void => {
			map.fitBounds(toLeafletBounds({ west, south, east, north }), {
				padding: [BOUNDS_PADDING_PX, BOUNDS_PADDING_PX],
				animate: false,
			});
		};
		fit();
		map.on('resize', fit);
		return () => {
			map.off('resize', fit);
		};
	}, [map, west, south, east, north]);
	return null;
}

function PointDetails({ point, labelKey, detailKeys }: { point: MapPoint; labelKey?: string; detailKeys: string[] }) {
	return (
		<div className='nao-map__tooltip'>
			{labelKey && <strong>{String(point.row[labelKey] ?? '')}</strong>}
			{detailKeys.map((key) => (
				<div key={key}>
					{key}: {formatNumber(point.row[key])}
				</div>
			))}
		</div>
	);
}

interface ResolvedKeys {
	latitudeKey: string;
	longitudeKey: string;
	sizeKey?: string;
	labelKey?: string;
}

/** Coordinates are matched by name when not given, so a plain `SELECT city, lat, lng` maps without configuration. */
function resolveKeys(
	rows: Row[],
	columns: string[],
	keys: Pick<PointMapProps, 'latitudeKey' | 'longitudeKey' | 'sizeKey' | 'labelKey'>,
): ResolvedKeys | null {
	const latitudeKey = keys.latitudeKey
		? findColumn(columns, keys.latitudeKey)
		: detectColumn(rows, columns, LATITUDE_COLUMN);
	const longitudeKey = keys.longitudeKey
		? findColumn(columns, keys.longitudeKey)
		: detectColumn(rows, columns, LONGITUDE_COLUMN);
	if (!latitudeKey || !longitudeKey) {
		return null;
	}
	const coordinateKeys = [latitudeKey, longitudeKey];
	return {
		latitudeKey,
		longitudeKey,
		sizeKey: keys.sizeKey ? resolveColumnName(columns, keys.sizeKey) : undefined,
		labelKey: keys.labelKey
			? resolveColumnName(columns, keys.labelKey)
			: columns.find((column) => !coordinateKeys.includes(column) && !isNumericColumn(rows, column)),
	};
}

function findColumn(columns: string[], key: string): string | undefined {
	const column = resolveColumnName(columns, key);
	return columns.includes(column) ? column : undefined;
}

function detectColumn(rows: Row[], columns: string[], pattern: RegExp): string | undefined {
	return columns.find((column) => pattern.test(column) && isNumericColumn(rows, column));
}

function defaultTooltipKeys(keys: ResolvedKeys): string[] {
	return keys.sizeKey ? [keys.sizeKey] : [];
}

function toLeafletBounds(bounds: MapBounds): LatLngBoundsExpression {
	return [
		[bounds.south, bounds.west],
		[bounds.north, bounds.east],
	];
}
