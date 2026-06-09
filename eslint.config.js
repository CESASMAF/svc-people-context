// Flat config — typescript-eslint v8 + ESLint 9 (people-context · Bun 1.3.14 · TS 6.0)
// Espelha o setup de qualidade do core-api, adaptado à stack funcional (no-class)
// deste serviço. Docs: https://typescript-eslint.io/getting-started
//
// Estado: limpeza incremental CONCLUÍDA (ticket PEO-LINT-ZERO). TODAS as regras
// type-checked foram zeradas e promovidas de `warn` → `error` — o lint nasce com
// ZERO warnings e qualquer regressão (warn que vira error) trava `bun run lint`.
// As duas carve-outs de escopo (não exceções de severidade) são:
//   • naming-convention: permite snake_case em typeProperty SÓ em src/idp/** (DTOs
//     que espelham o wire-format Authentik DRF/OIDC — nome ditado pelo protocolo);
//   • explicit-function-return-type: off SÓ em src/routes/** (factories Elysia
//     retornam tipo genérico inominável sem recorrer a `any`).
// Regra nova type-checked entra direto como `error`.

import eslint from "@eslint/js";
import prettierConfig from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      "coverage/**",
      "*.config.js",
      // Scripts utilitários em JS puro (fora do tsconfig type-aware).
      "scripts/check-coverage.js",
      // Artefatos spec-kit (SDD): specs/<feature>/ guarda esboços/contratos de
      // design (.ts ilustrativos) que não entram em nenhum tsconfig.
      "specs/**",
      // Tooling organizacional — formatação/estrutura própria.
      ".specify/**",
      ".pipeline/**",
      "handbook/**",
    ],
  },

  // Base — JS recommended
  eslint.configs.recommended,

  // TypeScript — strict + type-aware (igual core-api)
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ===========================================================
      // Invariantes do serviço (.claude/rules/functional-ts.md)
      // ===========================================================
      // Classes proibidas — composição + factory functions (closures).
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration",
          message:
            "Classes são proibidas (.claude/rules/functional-ts.md) — use `Readonly<{}>` + funções standalone e factory `createXxx(deps)`.",
        },
        {
          selector: "ClassExpression",
          message:
            "Classes são proibidas (.claude/rules/functional-ts.md) — use `Readonly<{}>` + funções standalone e factory `createXxx(deps)`.",
        },
      ],

      // Libs desnecessárias — o runtime nativo (fetch/Intl/Web Crypto) cobre.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "axios",
              message: "Desnecessária — use o `fetch` global do Bun.",
            },
            {
              name: "moment",
              message: "Desnecessária — use `Intl` / `Temporal` nativos.",
            },
            {
              name: "crypto-js",
              message: "Desnecessária — use Web Crypto nativo (`crypto.subtle`).",
            },
          ],
          patterns: [
            {
              group: ["lodash", "lodash/*"],
              message:
                "Desnecessária — o runtime nativo cobre (map/filter/Object/structuredClone).",
            },
          ],
        },
      ],

      "prefer-const": "error",
      "no-var": "error",
      "@typescript-eslint/no-explicit-any": "error",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/dot-notation": "off",

      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: false, allowAny: false },
      ],

      "no-param-reassign": ["error", { props: false }],
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // ===========================================================
      // 🟢 Recomendadas — alinham com as invariantes
      // ===========================================================
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "@typescript-eslint/no-shadow": "error",
      "no-shadow": "off",
      "@typescript-eslint/no-loop-func": "error",
      "no-loop-func": "off",
      "@typescript-eslint/default-param-last": "error",
      "default-param-last": "off",
      // type X + const X é declaration merging válido (branded types). Off.
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
      "@typescript-eslint/max-params": ["error", { max: 4 }],
      "max-params": "off",
      "@typescript-eslint/no-useless-empty-export": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // ===========================================================
      // ✅ Correção type-checked — `error` (limpeza PEO-LINT-ZERO concluída).
      //   Eram dívida de adoção em `warn`; o código foi corrigido e todas
      //   foram promovidas a `error`. Junto das INVARIANTES duras (no-class,
      //   no-throw em domain/application, no-any, libs proibidas), formam o
      //   gate de regressão zero — qualquer nova violação trava `bun run lint`.
      // ===========================================================
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // restrict-template-expressions já é `error` no bloco de invariantes acima.
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-invalid-void-type": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",

      // ===========================================================
      // ✅ Estruturais/estéticas — `error` (promovidas após a limpeza).
      //     explicit-function-return-type: off só em src/routes/** (Elysia);
      //     naming-convention: snake_case em typeProperty só em src/idp/**.
      // ===========================================================
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/prefer-readonly-parameter-types": [
        "error",
        {
          checkParameterProperties: false,
          ignoreInferredTypes: true,
          treatMethodsAsReadonly: true,
        },
      ],
      "@typescript-eslint/member-ordering": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "typeProperty",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          filter: { regex: "[- :]", match: false },
        },
        { selector: "objectLiteralProperty", format: null },
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
    },
  },

  // -----------------------------------------------------------
  // domain/ + application/ — fronteira pura: PROIBIDO `throw`
  // (.claude/rules/functional-ts.md — erros são valores/Result).
  // -----------------------------------------------------------
  {
    files: ["src/domain/**/*.ts", "src/application/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration",
          message: "Classes são proibidas — use `Readonly<{}>` + funções standalone.",
        },
        {
          selector: "ClassExpression",
          message: "Classes são proibidas — use `Readonly<{}>` + funções standalone.",
        },
        {
          selector: "ThrowStatement",
          message:
            "`throw` proibido em domain/application (ADR-014) — retorne ValidationResult/AuthentikResult. `throw` só em adapters, convertido a Result no contorno.",
        },
      ],
    },
  },

  // -----------------------------------------------------------
  // Adapters de I/O — tipos externos mutáveis (postgres `Sql`, fetch,
  // NATS, jose) e async-sem-await legítimo (ex.: noop publishers).
  // -----------------------------------------------------------
  {
    files: [
      "src/repository/**/*.ts",
      "src/idp/**/*.ts",
      "src/events/**/*.ts",
      "src/middleware/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
    },
  },

  // -----------------------------------------------------------
  // IdP wire DTOs — tipos que espelham o JSON do Authentik DRF / OIDC.
  // Os nomes snake_case (is_active, date_joined, user_pk, error_description,
  // groups_obj, legacy_zitadel_sub…) são ditados pelo PROTOCOLO, não pelo
  // nosso estilo; renomear quebraria o mapeamento de wire. Permite snake_case
  // APENAS em typeProperty; os demais identificadores seguem estritos.
  // -----------------------------------------------------------
  {
    files: ["src/idp/**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "typeProperty",
          format: ["camelCase", "snake_case"],
          leadingUnderscore: "allow",
          filter: { regex: "[- :]", match: false },
        },
        { selector: "objectLiteralProperty", format: null },
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
    },
  },

  // -----------------------------------------------------------
  // Borda HTTP — handlers Elysia retornam promise sem await; Context é mutável.
  // -----------------------------------------------------------
  {
    files: ["src/routes/**/*.ts"],
    rules: {
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "@typescript-eslint/promise-function-async": "off",
      "@typescript-eslint/require-await": "off",
      // As factories `createXxxRoutes` retornam o tipo genérico do Elysia
      // (`Elysia<prefix, singleton, routes…>`), que é INOMINÁVEL sem recorrer a
      // `any` (proibido). Anotar o retorno aqui é impraticável — a regra fica
      // `error` em todas as demais camadas e off só nesta borda HTTP.
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  // -----------------------------------------------------------
  // Scripts (state machine da pipeline, utilitários) — CLI style.
  // -----------------------------------------------------------
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-console": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  // -----------------------------------------------------------
  // Testes — bun:test design + fakes in-memory (async sem await,
  // shadowing de fixtures, generics de helper, type-imports inline).
  // -----------------------------------------------------------
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/promise-function-async": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/max-params": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-restricted-syntax": "off",
      "@typescript-eslint/no-shadow": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/array-type": "off",
    },
  },

  // -----------------------------------------------------------
  // Prettier — desliga regras de estilo que conflitam com o formatter.
  // DEVE ser o último config (sobrescreve tudo).
  // -----------------------------------------------------------
  prettierConfig,
);
