import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_FILENAMES = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];

export const chartFontFiles: string[] = resolveChartFontFiles();

/**
 * Resolved once at import: the bundled fonts never move at runtime, and a
 * missing directory must degrade to system fonts rather than fail a render.
 */
function resolveChartFontFiles(): string[] {
	const fontsDirectory = resolveFontsDirectory();
	if (!fontsDirectory) {
		return [];
	}
	return FONT_FILENAMES.map((filename) => join(fontsDirectory, filename)).filter((path) => existsSync(path));
}

function resolveFontsDirectory(): string | undefined {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const executableDir = dirname(process.execPath);
	const candidates = [
		join(executableDir, 'assets/fonts'),
		join(currentDir, 'assets/fonts'),
		join(currentDir, '../assets/fonts'),
		join(currentDir, '../../assets/fonts'),
		join(currentDir, '../../../assets/fonts'),
	];
	return candidates.find((directory) => existsSync(directory));
}
