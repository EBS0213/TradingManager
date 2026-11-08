// Expand tests without depending on the user's shell (Windows cmd does not glob).
import {readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root = fileURLToPath(new URL('..', import.meta.url))
const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => /\.test\.(mjs|cjs)$/.test(name)).sort().map(name => 'tests/'+name)
if (!tests.length) throw new Error('No regression tests found')
const result = spawnSync(process.execPath, ['--test', ...tests], {cwd:root, stdio:'inherit'})
if(result.error) throw result.error
process.exit(result.status ?? 1)
