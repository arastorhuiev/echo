# 0014. `.js` suffixes in TypeScript imports for NodeNext ESM

**Status:** Accepted
**Date:** 2026-05-14

## Context

Several packages in the monorepo use ESM with `module: "NodeNext"` and `moduleResolution: "NodeNext"` (e.g., `@echo/db`, `@echo/config`, `@echo/observability`). In this configuration, TypeScript requires that **relative imports include a `.js` extension** matching what Node will see at runtime, even though the source files are `.ts`.

This looks visually wrong ("the file is `.ts`, why am I importing `.js`?") and it has tripped up reviewers more than once.

## Decision

Keep `.js` extensions in all relative imports for ESM packages. Document this rule and refer to it from team materials so it doesn't get re-litigated.

```ts
// In an ESM package (e.g., @echo/db):
import { foo } from "./bar.js"          // ✅ file is bar.ts; the import string says "bar.js"
import { foo } from "@/bar.js"          // ✅ same rule applies to @/ alias resolution
import { foo } from "./bar"             // ❌ TS error "import path needs an explicit extension"
import { foo } from "./bar.ts"          // ❌ TS forbids unless allowImportingTsExtensions=true
```

For CommonJS packages (e.g., `apps/api` and `apps/worker` which set `"type": "commonjs"`), no extension is needed — CJS resolution still walks `.js` → `.json` → `index.js` automatically:

```ts
// In a CJS package (apps/api):
import { foo } from "./bar"             // ✅ CJS resolution handles it
```

## How the runtime sees this

TypeScript **does not rewrite** import strings during compilation. `import { foo } from "./bar.js"` in source becomes `require("./bar.js")` (CJS emit) or stays `import { foo } from "./bar.js"` (ESM emit) in the generated `dist/`. Node ESM at runtime resolves `./bar.js` against the `dist/` folder where the compiled `bar.js` lives. Everything matches.

## Consequences

**Good:**
- Output JavaScript in `dist/` has the same import strings TypeScript saw — predictable.
- Node ESM resolves runtime files correctly without a bundler or loader.
- Forward-compatible with TypeScript 7+ which is moving toward stricter ESM.
- `.d.ts` declaration files reference `.js` paths consistently with the JS they document.

**Bad:**
- Visually confusing for newcomers who haven't seen the convention.
- Cross-language muscle memory ("but the file is `.ts`!") doesn't help here.

## Alternatives considered

- **`moduleResolution: "Bundler"`** — allows extension-less imports but requires a bundler at runtime. Doesn't work with `node dist/main.js` directly. Rejected for ESM packages we ship to Node.
- **`allowImportingTsExtensions: true`** — lets you write `./bar.ts` directly, but requires `noEmit: true`. Incompatible with our build pipeline (we DO emit). Rejected.
- **Switch every workspace package to CommonJS** — would let us drop extensions entirely, but loses ESM future-proofing and is a step backward. Rejected.
- **Use `.mjs` source extension** — fixes the visual ("import `bar.mjs` from `bar.mts`") but TypeScript tooling has weaker support for `.mts`. Rejected.

## Triggers to reconsider

- TypeScript 7+ changes the ESM import requirements (e.g., introduces auto-rewriting).
- We adopt a bundler (esbuild, swc, tsup) for all workspace packages — Bundler resolution becomes viable everywhere.
- Node ESM gains extension-inference for CJS-style resolution (long-rumoured, not happening soon).
