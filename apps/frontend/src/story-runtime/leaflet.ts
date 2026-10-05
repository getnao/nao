/* Leaflet ships as UMD, so `export *` cannot be resolved statically; the names mirror its ESM entry point. */
import * as module from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?inline';
import markerIcon from 'leaflet/dist/images/marker-icon.png?inline';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?inline';
import leafletStyles from 'leaflet/dist/leaflet.css?inline';

const STYLE_ID = 'nao-leaflet';

installAssets();

export const {
	Bounds,
	Browser,
	CRS,
	Canvas,
	Circle,
	CircleMarker,
	Class,
	Control,
	DivIcon,
	DivOverlay,
	DomEvent,
	DomUtil,
	Draggable,
	Evented,
	FeatureGroup,
	GeoJSON,
	GridLayer,
	Handler,
	Icon,
	ImageOverlay,
	LatLng,
	LatLngBounds,
	Layer,
	LayerGroup,
	LineUtil,
	Map,
	Marker,
	Mixin,
	Path,
	Point,
	PolyUtil,
	Polygon,
	Polyline,
	Popup,
	PosAnimation,
	Projection,
	Rectangle,
	Renderer,
	SVG,
	SVGOverlay,
	TileLayer,
	Tooltip,
	Transformation,
	Util,
	VideoOverlay,
	bind,
	bounds,
	canvas,
	circle,
	circleMarker,
	control,
	divIcon,
	extend,
	featureGroup,
	geoJSON,
	geoJson,
	gridLayer,
	icon,
	imageOverlay,
	latLng,
	latLngBounds,
	layerGroup,
	map,
	marker,
	point,
	polygon,
	polyline,
	popup,
	rectangle,
	setOptions,
	stamp,
	svg,
	svgOverlay,
	tileLayer,
	tooltip,
	transformation,
	version,
	videoOverlay,
} = module;

export default module;

function installAssets(): void {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = leafletStyles;
		document.head.prepend(style);
	}
	delete (module.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
	module.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });
}
