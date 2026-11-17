import { build } from 'esbuild'
import { copyFile } from 'node:fs/promises'

await build({ entryPoints: ['src/desktop/entry.js'], outfile: 'plugin.js', bundle: true, format: 'esm', platform: 'browser', external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'] })
await copyFile('plugin.js', 'desktop/plugin.js')
await copyFile('plugin.js', 'desktop-plugins/marketing-system/plugin.js')
