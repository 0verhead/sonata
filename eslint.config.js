// ESLint 9 flat config for TypeScript project
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import nodePlugin from 'eslint-plugin-n';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,

  // Node.js plugin recommended rules
  nodePlugin.configs['flat/recommended'],

  // Unicorn plugin recommended rules
  unicorn.configs.recommended,

  // Import plugin TypeScript config
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  // Prettier compat (disables conflicting rules) - must be last
  eslintConfigPrettier,

  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },

  // Project-specific configuration
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      // TypeScript-specific adjustments
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      // Import sorting and organization
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import-x/no-duplicates': 'error',

      // Node.js rules adjustments
      'n/no-missing-import': 'off', // TypeScript handles this
      'n/no-unsupported-features/es-syntax': 'off', // We're using ESM
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=18' }],
      'n/no-process-exit': 'off', // CLI tool needs process.exit

      // Unicorn adjustments for this project
      'unicorn/no-null': 'off', // Allow null (used in API responses)
      'unicorn/prevent-abbreviations': 'off', // Allow common abbreviations
      'unicorn/no-process-exit': 'off', // CLI tool needs process.exit
      'unicorn/no-array-callback-reference': 'off', // Allow method references
      'unicorn/prefer-top-level-await': 'off', // Not always appropriate in CLI
    },
  }
);
