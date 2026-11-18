import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// v6 resolves its worker from `import.meta.url`, which Vite breaks; import `maplibregl` from here, not 'maplibre-gl'.
setWorkerUrl(workerUrl);

export * as maplibregl from 'maplibre-gl';
