import React from 'react'
import { determineSystemHealth, formatMetric } from '../ops/health.js'
const h = (type, props, ...children) => React.createElement(type, props, ...children)
const panel = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 'var(--ui-radius-sm, 4px)', padding: '14px' }
const muted = { color: 'var(--ui-text-tertiary)', fontSize: '0.82rem' }

export default function SystemHealth({ snapshot = null, metrics = {}, now, staleAfterMs, onRetry, onPause, onResume }) {
  const health = determineSystemHealth(snapshot, { now, staleAfterMs })
  const freshness = health.observedAt ? `Last checked ${String(health.observedAt)}` : 'Freshness unavailable'
  const services = health.services.map(service => h('li', {
    key: service?.name ?? service?.id ?? service?.status,
    style: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0' },
  }, h('span', null, service?.name ?? 'Unnamed service'),
  h('span', { 'aria-label': 'Service status' }, service?.status ?? 'Unavailable')))
  const metricNodes = Object.entries(metrics).map(([name, value]) => h('div', {
    key: name,
    style: { ...panel, minWidth: '140px', flex: '1 1 140px' },
  }, h('div', { style: muted }, name),
  h('div', { style: { marginTop: '6px', fontSize: '1.2rem' } }, formatMetric(value))))
  const action = (label, callback) => h('button', {
    key: label,
    type: 'button',
    disabled: typeof callback !== 'function',
    onClick: () => { if (typeof callback === 'function') callback() },
  }, label)

  return h('section', { 'aria-label': 'System health', style: { display: 'grid', gap: '14px' } },
    h('header', { style: panel },
      h('h2', { style: { margin: '0 0 5px' } }, 'System health'),
      h('div', { role: 'status', 'aria-live': 'polite' }, health.label),
      h('div', { style: muted }, freshness)),
    h('section', { 'aria-label': 'Services', style: panel },
      h('h3', null, 'Services'),
      services.length ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } }, ...services) : h('p', { style: muted }, 'Service details unavailable.')),
    h('section', { 'aria-label': 'Metrics', style: { display: 'flex', flexWrap: 'wrap', gap: '9px' } },
      metricNodes.length ? metricNodes : h('p', { style: muted }, 'Metrics unavailable.')),
    h('nav', { 'aria-label': 'Health actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      action('Retry', onRetry), action('Pause', onPause), action('Resume', onResume)))
}

