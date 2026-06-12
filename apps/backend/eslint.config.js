import rootConfig from '../../eslint.config.js';

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
		ignores: ['migrations/'],
	},
];
