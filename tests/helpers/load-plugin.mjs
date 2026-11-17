import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadPlugin() {
  const runtime = path.resolve('.artifacts/evidence/ui-runtime')
  await mkdir(runtime, { recursive: true })
  const directory = await mkdtemp(path.join(runtime, 'plugin-'))
  const outfile = path.join(directory, 'plugin.mjs')
  const hostStub = path.join(directory, 'sdk.mjs')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(hostStub, `import React from 'react'; export const Button = p => React.createElement('button', p, p.children); export const Badge = p => React.createElement('span', p, p.children); export const EmptyState = p => React.createElement('div', p, p.description); export const ROUTES_AREA='routes'; export const SIDEBAR_NAV_AREA='sidebar.nav'; export const PALETTE_AREA='commandPalette'; export const host={navigate(){}}`)
  await build({ entryPoints: ['plugin.js'], outfile, bundle: true, format: 'esm', platform: 'node', external: ['react', 'react/jsx-runtime'], plugins: [{ name: 'sdk-mock', setup(build) { build.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, () => ({ path: hostStub })) } }] })
  const plugin = await import(pathToFileURL(outfile).href + `?v=${Date.now()}`)
  return { default: plugin.default, cleanup: () => rm(directory, { recursive: true, force: true }) }
}
