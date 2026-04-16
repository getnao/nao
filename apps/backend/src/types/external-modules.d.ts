declare module '@fastify/multipart' {
	import type { FastifyPluginAsync } from 'fastify';

	export interface MultipartFile {
		fieldname: string;
		filename: string;
		encoding: string;
		mimetype: string;
		file: AsyncIterable<Buffer>;
		toBuffer(): Promise<Buffer>;
	}

	const multipart: FastifyPluginAsync<{
		limits?: {
			fileSize?: number;
		};
	}>;

	export default multipart;
}

declare module 'js-yaml' {
	export function load(input: string): unknown;

	const yaml: {
		load: typeof load;
	};

	export default yaml;
}
