//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

import rootConfig from '../../eslint.config.js';

export default [
	...rootConfig,
	...tanstackConfig,
	{
		plugins: {
			'react-hooks': reactHooks,
		},
		rules: {
			'simple-import-sort/imports': 'off',
			'simple-import-sort/exports': 'off',
			'sort-imports': ['error', { ignoreDeclarationSort: true, ignoreMemberSort: true }],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/array-type': 'off',
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
	{
		ignores: ['eslint.config.js'],
	},
];
