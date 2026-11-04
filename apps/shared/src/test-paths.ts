export const TESTS_FOLDER = 'tests';
export const TEST_OUTPUTS_FOLDER = 'outputs';

const TEST_FILE_NAME_PATTERN = /\.ya?ml$/;

/**
 * The path of a test relative to the tests folder, or null when the project path is not a file `nao test` discovers:
 * a YAML file in the tests folder, outside its outputs folders.
 */
export function toTestPath(projectPath: string): string | null {
	const [folder, ...segments] = projectPath.replaceAll('\\', '/').replace(/^\/+/, '').split('/');
	const fileName = segments.at(-1);
	const isTestFile =
		folder === TESTS_FOLDER &&
		fileName !== undefined &&
		isTestFileName(fileName) &&
		!segments.slice(0, -1).includes(TEST_OUTPUTS_FOLDER) &&
		!segments.includes('..');
	return isTestFile ? segments.join('/') : null;
}

export function isTestFilePath(projectPath: string): boolean {
	return toTestPath(projectPath) !== null;
}

export function isTestFileName(fileName: string): boolean {
	return TEST_FILE_NAME_PATTERN.test(fileName);
}

export function isInTestsFolder(projectPath: string): boolean {
	return projectPath.replace(/^\/+/, '').startsWith(`${TESTS_FOLDER}/`);
}

export function toExplorerTestPath(testPath: string): string {
	return `/${TESTS_FOLDER}/${testPath}`;
}

export function fromExplorerTestPath(explorerPath: string): string {
	return explorerPath.replace(new RegExp(`^/?${TESTS_FOLDER}/`), '');
}
