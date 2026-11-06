import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'max-lines': [
        'error',
        {
          max: 300,
          skipBlankLines: false,
          skipComments: false,
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      'max-lines': [
        'error',
        {
          max: 300,
          skipBlankLines: false,
          skipComments: false,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: [
      'src/react/**/*.{ts,tsx}',
      'src/react-native/**/*.{ts,tsx}',
      'tests/**/*.tsx',
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/client/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'vue',
                '@angular/*',
                '**/react/**',
                '**/vue/**',
                '**/angular/**',
                '**/blur/blurDataUtils*',
              ],
              message:
                'src/client must remain framework-agnostic and free of canvas/DOM dependencies.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/vue/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                '@angular/*',
                '**/react/**',
                '**/angular/**',
                '**/react-native/**',
              ],
              message:
                'src/vue must not import React, Angular, or React Native modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/angular/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'vue',
                '**/react/**',
                '**/vue/**',
                '**/react-native/**',
              ],
              message:
                'src/angular must not import React, Vue, or React Native modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/react-native/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-dom',
                'vue',
                '@angular/*',
                '**/react/**',
                '**/vue/**',
                '**/angular/**',
                '**/blur/blurDataUtils*',
              ],
              message:
                'src/react-native must not import react-dom, Vue, Angular, or canvas-based blurDataUtils.',
            },
          ],
        },
      ],
    },
  },
);
