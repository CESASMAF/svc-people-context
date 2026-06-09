# W3 (GREEN) — PEO-LINT-ZERO — gate /speckit-verify

`bun run verify` EXIT 0:
- tsc --noEmit ✓
- prettier --check . ✓
- eslint . ✓ (0 warnings, 0 errors)
- bun test ✓ (255 pass / 8 skip / 0 fail; 526 expects)
- coverage 97.95% ✓ (≥95%)

Política de regressão zero ATIVA: todas as regras type-checked são `error`.
