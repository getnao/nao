//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import rootConfig from '../../eslint.config.js';

export default [
	...rootConfig,
	...tanstackConfig,
	// @tanstack/eslint-config enables type-aware rules (parserOptions.project=true)
	// which load the full TypeScript program and cause heap OOM on 16 GB dev machines.
	// Disable all type-aware rules and prevent parser from loading the TS program.
	tseslint.configs.disableTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				project: false,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
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
