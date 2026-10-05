const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const directory = mkdtempSync(join(tmpdir(), 'bili-tests-'))
try {
  let result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', 'lib/video-url.ts', 'lib/sse.ts', '--target', 'es2022', '--module', 'commonjs', '--outDir', directory, '--skipLibCheck'], { stdio: 'inherit' })
  if (!result.status) result = spawnSync(process.execPath, ['--test', 'tests/core.cjs'], { stdio: 'inherit', env: { ...process.env, BILI_TEST_BUILD: directory } })
  process.exitCode = result.status || 0
} finally { rmSync(directory, { recursive: true, force: true }) }
