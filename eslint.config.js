import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/target/**',
      '**/public/ort/**',
      '**/public/mediapipe/**',
      '**/public/piper/**',
      '**/public/third-party/**',
      '**/src/vendor/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        self: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        process: 'readonly',
        crypto: 'readonly',
        Response: 'readonly',
        Uint8Array: 'readonly',
        __CACHE__: 'readonly',
        __ASSETS__: 'readonly',
      },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        process: 'readonly',
        crypto: 'readonly',
        Response: 'readonly',
        Uint8Array: 'readonly',
        __CACHE__: 'readonly',
        __ASSETS__: 'readonly',
      },
    },
  },
);
