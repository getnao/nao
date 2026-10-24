//  @ts-check

import reactHooks from 'eslint-plugin-react-hooks';

import rootConfig from '../../eslint.config.js';

export default [
	...rootConfig,
	{
		plugins: {
			'react-hooks': reactHooks,
		},
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
	{
		ignores: ['src-tauri/', 'dist/', 'eslint.config.js'],
	},
];
