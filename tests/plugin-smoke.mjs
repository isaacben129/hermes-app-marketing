import { execFileSync } from 'node:child_process'

execFileSync(process.execPath, ['--test', 'tests/plugin-react.test.mjs'], { stdio: 'inherit' })
