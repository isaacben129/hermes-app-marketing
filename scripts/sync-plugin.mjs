import { copyFile } from 'node:fs/promises'
await copyFile('plugin.js', 'desktop/plugin.js')
await copyFile('plugin.js', 'desktop-plugins/marketing-system/plugin.js')
