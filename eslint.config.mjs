// See: https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import jest from 'eslint-plugin-jest'
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'

export default [
  {
    ignores: ['**/coverage', '**/dist', '**/linter', '**/node_modules']
  },
  js.configs.recommended,
  typescriptEslint.configs['flat/eslint-recommended'],
  ...typescriptEslint.configs['flat/recommended'],
  jest.configs['flat/recommended'],
  prettierConfig,
  {
    plugins: {
      prettier
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly'
      },

      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',

      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
          allowDefaultProject: [
            '__fixtures__/*.ts',
            '__tests__/*.ts',
            '__tests__/deploy/*.ts',
            '__tests__/static-site-client/*.ts',
            'eslint.config.mjs',
            'jest.config.js',
            'rolldown.config.ts'
          ]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },

    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: 'tsconfig.json'
        }
      }
    },

    rules: {
      camelcase: 'off',
      'eslint-comments/no-use': 'off',
      'eslint-comments/no-unused-disable': 'off',
      'i18n-text/no-en': 'off',
      'import/no-namespace': 'off',
      'no-console': 'off',
      'no-shadow': 'off',
      'no-unused-vars': 'off',
      'prettier/prettier': 'error'
    }
  }
]
