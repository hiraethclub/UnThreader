// Validates that the injected Threads runtime is syntactically valid JavaScript.
// tsc only type-checks the surrounding module — it cannot see inside the runtime
// string — so this transpiles the two source files and parses the string with
// `new Function`, which throws on any syntax error.
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const OUT = 'scratch/check-injected'
try {
  execSync(
    `npx tsc src/main/automation/selectors.ts src/main/automation/injected.ts ` +
      `--outDir ${OUT} --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
    { stdio: 'inherit' }
  )
  const mod = await import(`../${OUT}/injected.js`)
  // Throws on a syntax error inside the runtime string.
  // eslint-disable-next-line no-new-func
  new Function(mod.INJECTED_RUNTIME)
  console.log(`OK: injected runtime parses (${mod.INJECTED_RUNTIME.length} chars)`)
} catch (err) {
  console.error('FAIL: injected runtime did not validate:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  rmSync(OUT, { recursive: true, force: true })
}
