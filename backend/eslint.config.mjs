import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off', // Nest DI needs value imports for injected classes
      // Money must never pass through floating point: see docs/business-rules.md N1.
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='parseFloat']", message: 'Do not parse money as floating point.' },
        { selector: "CallExpression[callee.property.name='toFixed']", message: 'Use the money module for rounding.' },
      ],
    },
  },
);
