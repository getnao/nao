import {
	IconBraces,
	IconBrandCss3,
	IconBrandDocker,
	IconBrandHtml5,
	IconBrandJavascript,
	IconBrandPython,
	IconBrandTypescript,
	IconCode,
	IconDatabase,
	IconFile,
	IconFileDatabase,
	IconFileText,
	IconFolder,
	IconGitBranch,
	IconLock,
	IconLogs,
	IconMarkdown,
	IconNotebook,
	IconSettingsCode,
	IconSql,
	IconTable,
	IconTerminal2,
} from '@tabler/icons-react';

import { cn } from '@/lib/utils';

interface FileExplorerIconProps {
	name: string;
	type: 'file' | 'directory';
	className?: string;
}

type IconDefinition = {
	icon: typeof IconFile;
	color: string;
};

const FOLDER_ICON: IconDefinition = {
	icon: IconFolder,
	color: 'text-blue-600 dark:text-blue-400',
};

const FILE_NAME_ICONS: Record<string, IconDefinition> = {
	'.gitattributes': { icon: IconGitBranch, color: 'text-orange-600 dark:text-orange-400' },
	'.gitignore': { icon: IconGitBranch, color: 'text-orange-600 dark:text-orange-400' },
	'.prettierignore': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	'.prettierrc': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	dockerfile: { icon: IconBrandDocker, color: 'text-sky-600 dark:text-sky-400' },
	'nao_config.yaml': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	'pyproject.toml': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
};

const EXTENSION_ICONS: Record<string, IconDefinition> = {
	'.bash': { icon: IconTerminal2, color: 'text-emerald-600 dark:text-emerald-400' },
	'.cjs': { icon: IconBrandJavascript, color: 'text-yellow-600 dark:text-yellow-400' },
	'.css': { icon: IconBrandCss3, color: 'text-indigo-600 dark:text-indigo-400' },
	'.csv': { icon: IconTable, color: 'text-emerald-600 dark:text-emerald-400' },
	'.cts': { icon: IconBrandTypescript, color: 'text-blue-600 dark:text-blue-400' },
	'.db': { icon: IconDatabase, color: 'text-cyan-600 dark:text-cyan-400' },
	'.duckdb': { icon: IconDatabase, color: 'text-cyan-600 dark:text-cyan-400' },
	'.fish': { icon: IconTerminal2, color: 'text-emerald-600 dark:text-emerald-400' },
	'.html': { icon: IconBrandHtml5, color: 'text-orange-600 dark:text-orange-400' },
	'.htm': { icon: IconBrandHtml5, color: 'text-orange-600 dark:text-orange-400' },
	'.ipynb': { icon: IconNotebook, color: 'text-orange-600 dark:text-orange-400' },
	'.js': { icon: IconBrandJavascript, color: 'text-yellow-600 dark:text-yellow-400' },
	'.json': { icon: IconBraces, color: 'text-amber-600 dark:text-amber-400' },
	'.jsx': { icon: IconBrandJavascript, color: 'text-yellow-600 dark:text-yellow-400' },
	'.less': { icon: IconBrandCss3, color: 'text-indigo-600 dark:text-indigo-400' },
	'.lock': { icon: IconLock, color: 'text-amber-600 dark:text-amber-400' },
	'.log': { icon: IconLogs, color: 'text-slate-500 dark:text-slate-400' },
	'.markdown': { icon: IconMarkdown, color: 'text-blue-600 dark:text-blue-400' },
	'.md': { icon: IconMarkdown, color: 'text-blue-600 dark:text-blue-400' },
	'.mdc': { icon: IconMarkdown, color: 'text-blue-600 dark:text-blue-400' },
	'.mdx': { icon: IconMarkdown, color: 'text-blue-600 dark:text-blue-400' },
	'.mjs': { icon: IconBrandJavascript, color: 'text-yellow-600 dark:text-yellow-400' },
	'.mts': { icon: IconBrandTypescript, color: 'text-blue-600 dark:text-blue-400' },
	'.parquet': { icon: IconFileDatabase, color: 'text-teal-600 dark:text-teal-400' },
	'.ps1': { icon: IconTerminal2, color: 'text-emerald-600 dark:text-emerald-400' },
	'.py': { icon: IconBrandPython, color: 'text-yellow-600 dark:text-yellow-400' },
	'.pyi': { icon: IconBrandPython, color: 'text-yellow-600 dark:text-yellow-400' },
	'.sass': { icon: IconBrandCss3, color: 'text-indigo-600 dark:text-indigo-400' },
	'.scss': { icon: IconBrandCss3, color: 'text-indigo-600 dark:text-indigo-400' },
	'.sh': { icon: IconTerminal2, color: 'text-emerald-600 dark:text-emerald-400' },
	'.sql': { icon: IconSql, color: 'text-sky-600 dark:text-sky-400' },
	'.sqlite': { icon: IconDatabase, color: 'text-cyan-600 dark:text-cyan-400' },
	'.sqlite3': { icon: IconDatabase, color: 'text-cyan-600 dark:text-cyan-400' },
	'.toml': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	'.ts': { icon: IconBrandTypescript, color: 'text-blue-600 dark:text-blue-400' },
	'.tsv': { icon: IconTable, color: 'text-emerald-600 dark:text-emerald-400' },
	'.tsx': { icon: IconBrandTypescript, color: 'text-blue-600 dark:text-blue-400' },
	'.txt': { icon: IconFileText, color: 'text-muted-foreground' },
	'.yaml': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	'.yml': { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' },
	'.zsh': { icon: IconTerminal2, color: 'text-emerald-600 dark:text-emerald-400' },
};

const CONFIG_EXTENSIONS = new Set(['.cfg', '.conf', '.config', '.ini']);
const TEXT_EXTENSIONS = new Set(['.rst', '.text']);
const CODE_EXTENSIONS = new Set([
	'.c',
	'.cc',
	'.cpp',
	'.cs',
	'.go',
	'.h',
	'.hpp',
	'.java',
	'.kt',
	'.lua',
	'.php',
	'.r',
	'.rb',
	'.rs',
	'.scala',
	'.svg',
	'.swift',
	'.vue',
	'.xml',
]);

export function FileExplorerIcon({ name, type, className }: FileExplorerIconProps) {
	const definition = type === 'directory' ? FOLDER_ICON : getFileIconDefinition(name);
	const Icon = definition.icon;

	return (
		<Icon
			aria-hidden='true'
			focusable='false'
			stroke={1.5}
			className={cn('size-4 shrink-0', definition.color, className)}
		/>
	);
}

function getFileIconDefinition(name: string): IconDefinition {
	const lowerName = name.toLowerCase();
	const namedIcon = getNamedFileIcon(lowerName);
	if (namedIcon) {
		return namedIcon;
	}

	const dotIndex = lowerName.lastIndexOf('.');
	const extension = dotIndex === -1 ? '' : lowerName.slice(dotIndex);
	if (EXTENSION_ICONS[extension]) {
		return EXTENSION_ICONS[extension];
	}
	if (CONFIG_EXTENSIONS.has(extension)) {
		return { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' };
	}
	if (TEXT_EXTENSIONS.has(extension)) {
		return { icon: IconFileText, color: 'text-muted-foreground' };
	}
	if (CODE_EXTENSIONS.has(extension)) {
		return { icon: IconCode, color: 'text-slate-600 dark:text-slate-400' };
	}
	return { icon: IconFile, color: 'text-muted-foreground' };
}

function getNamedFileIcon(name: string): IconDefinition | undefined {
	if (FILE_NAME_ICONS[name]) {
		return FILE_NAME_ICONS[name];
	}
	if (name === '.env' || name.startsWith('.env.')) {
		return { icon: IconLock, color: 'text-amber-600 dark:text-amber-400' };
	}
	if (name.startsWith('dockerfile.')) {
		return { icon: IconBrandDocker, color: 'text-sky-600 dark:text-sky-400' };
	}
	if (name.includes('.config.') || name.endsWith('config.json') || (name.startsWith('.') && name.endsWith('rc'))) {
		return { icon: IconSettingsCode, color: 'text-violet-600 dark:text-violet-400' };
	}
	return undefined;
}
