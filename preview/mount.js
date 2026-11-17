import React from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../src/desktop/entry.js'

const values = new Map(Object.entries(JSON.parse(localStorage.getItem('marketing-preview-storage') || '{}')))
const ctx = { storage: { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, set: (key, value) => { values.set(key, value); localStorage.setItem('marketing-preview-storage', JSON.stringify(Object.fromEntries(values))) } }, files: { requestFolder: async () => ({ ok: false }), list: async () => ({ entries: [] }), readDataUrl: async () => ({ ok: false }) }, register: item => { if (item.id === 'page') window.marketingPage = item.render } }
plugin.register(ctx)
createRoot(document.getElementById('root')).render(window.marketingPage())
