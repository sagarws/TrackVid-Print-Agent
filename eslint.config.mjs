import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always']
    }
  },

  {
    files: ['electron/main/**/*.ts', 'electron/preload/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.cjs', '*.ts'],
    languageOptions: { globals: globals.node }
  },

  // Build scripts are standalone CommonJS CLIs: require() and console are the
  // right idioms there.
  {
    files: ['scripts/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-console': 'off' }
  },

  // Plain-JS files are parsed but not type-checked, as in Trackvid-CMS: the
  // plugins this config imports ship no usable types.
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked]
  },

  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'require', message: 'The renderer must use window.printAgent (preload bridge) instead of Node APIs.' },
        { name: 'process', message: 'The renderer has no process object. Ask the main process through the bridge.' }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'child_process', 'os', 'electron'], message: 'Node/Electron APIs are forbidden in the renderer. Use the preload bridge.' }
          ]
        }
      ]
    }
  },

  /*
   * The ported design system is VENDORED CODE, copied from Trackvid-CMS (which
   * ports it from TrackVid-Monitor). Same exemption as there, same reason: a
   * MUI `components` override object is typed `any` by MUI itself, and editing
   * these files to satisfy our rules turns every re-sync into a conflict.
   */
  {
    files: [
      'electron/renderer/@core/**/*.{ts,tsx}',
      'electron/renderer/@layouts/**/*.{ts,tsx}',
      'electron/renderer/configs/**/*.{ts,tsx}',
      'electron/renderer/theme/muiAugmentation.ts'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-extra-boolean-cast': 'off'
    }
  }
)
