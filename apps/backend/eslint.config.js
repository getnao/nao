import rootConfig from '../../eslint.config.js';

const EFFECT_RUNTIME_MESSAGE =
	'Run Effect programs through utils/effect-runtime, so they get the app tracer and clock.';

export default [
	...rootConfig,
	{
		languageOptions: {
			parserOptions: {
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['src/**/*.{ts,tsx}'],
		ignores: ['src/utils/effect-runtime.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				{
					name: 'setInterval',
					message: 'Use repeatInBackground or withHeartbeat from utils/effect-runtime.',
				},
			],
			'no-restricted-properties': [
				'error',
				...['runPromise', 'runPromiseExit', 'runFork', 'runSync', 'runSyncExit', 'runCallback'].map(
					(property) => ({
						object: 'Effect',
						property,
						message: EFFECT_RUNTIME_MESSAGE,
					}),
				),
			],
		},
	},
	{
		ignores: ['migrations/', 'projects/', 'storage/'],
	},
];
