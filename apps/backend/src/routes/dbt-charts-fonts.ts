import { z } from 'zod/v4';

import type { App } from '../app';
import { fetchFont } from '../services/dbt-charts.service';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	fileName: z.string().regex(/^[A-Za-z0-9._-]+\.(woff2?|ttf|otf)$/),
});

/** Serves the fonts referenced by rendered dbt Charts SVGs; the SVG's font URLs are rewritten to this route. */
export const dbtChartsFontsRoutes = async (app: App) => {
	app.get('/:fileName', { schema: { params: paramsSchema } }, async (request, reply) => {
		const upstream = await fetchFont(request.params.fileName);
		if (!upstream.ok) {
			throw new HandlerError('NOT_FOUND', 'Font not found');
		}
		const contentType = upstream.headers.get('content-type') ?? 'font/woff2';
		return reply
			.header('Content-Type', contentType)
			.header('Cache-Control', 'public, max-age=31536000, immutable')
			.header('Access-Control-Allow-Origin', '*')
			.send(Buffer.from(await upstream.arrayBuffer()));
	});
};
