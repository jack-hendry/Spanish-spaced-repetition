// Report-only as of Phase 0 of specs/015-typescript-lint-rollout/ROADMAP.md.
// Deliberately NOT wired into .github/workflows/ci.yml: a directory joins
// the CI gate once it is already clean, never before (roadmap
// non-negotiable #2, same rule ruff.toml's `include` list follows).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      'data/**',
      'specs/**',
      'tools/**',
      'eslint.config.mjs',
      '.claude/worktrees/**', // a stale worktree is a second copy of the repo and gets linted as one
    ],
  },
  {
    files: ['server/src/**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Named explicitly by the roadmap. Some are already on via a preset;
      // listing them anyway so a preset's membership changing between
      // minor versions cannot silently drop one (Analyst.md D3).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      complexity: ['error', 15],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['web/src/**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      complexity: ['error', 15],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // These four are angular-conventions, made mechanical.
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='subscribe']",
          message:
            'No .subscribe() in this app — use async + lastValueFrom, or toSignal(). See .claude/skills/angular-conventions.',
        },
      ],
    },
  },
  {
    files: ['web/src/app/features/**/*.ts'],
    rules: {
      // angular-conventions: "Features import from core/, never from each
      // other." Scoped to features/ and matched by regex, not glob: a
      // relative specifier like '../browser/browser' contains no literal
      // 'features' segment for a glob to match, and a `../*/` glob would
      // also catch core-to-core imports from elsewhere in the tree.
      // `(?!\.)` is what excludes '../../core/...' — one level up into a
      // sibling feature is banned, two levels up into core is not.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./(?!\\.)[^/]+/',
              message:
                'Features must not import from each other — go through core/. See .claude/skills/angular-conventions.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['web/src/app/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // same idiom as eqeqeq below; the template rule is configured separately
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  },
  {
    // Test-only relaxations. Each of these rules has a premise that does not
    // hold in a spec: `x!.y` in a test IS an assertion and fails loudly when
    // wrong, `unbound-method` fires on spy references, `() => {}` is a stub,
    // a stub component is a class with no members, and an `async` test with
    // no `await` is normal. Rules whose premise DOES still hold in a test --
    // no-unsafe-*, no-explicit-any, no-unnecessary-condition,
    // strict-boolean-expressions, eqeqeq -- stay on deliberately (Analyst.md
    // D3 and §5.1).
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
