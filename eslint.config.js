// @ts-check
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: [
      'eslint.config.js',
      'node_modules/**',
      'dist/**',
      'reports/**',
      'test-results/**',
      'playwright-report/**',
      'allure-results/**',
      'allure-report/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'warn',
    },
  },
  eslintConfigPrettier,
);
