import { execFileSync } from 'node:child_process'

// Keep the historical pipeline entrypoint, but run the production React route tests.
execFileSync(process.execPath, ['--test', 'tests/plugin-react.test.mjs'], { stdio: 'inherit' })
