import React from 'react'
import { formatJobChronology, redactError } from '../ops/health.js'

const h = (type, props, ...children) => React.createElement(type, props, ...children)
const panel = { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 'var(--ui-radius-sm, 4px)', padding: '14px' }
const muted = { color: 'var(--ui-text-tertiary)', fontSize: '0.82rem' }
const text = value => value === null || value === undefined || value === '' ? 'Unavailable' : String(value)

export default function JobDetail({ job = null, onRetry, onPause, onResume }) {
  if (!job) {
    return h('section', { 'aria-label': 'Job details', style: panel },
      h('h2', null, 'Job details'),
      h('p', { role: 'status', style: muted }, 'Job details unavailable.'))
  }

  const chronology = formatJobChronology(job)
  const action = (label, callback) => h('button', {
    key: label,
    type: 'button',
    disabled: typeof callback !== 'function',
    onClick: () => { if (typeof callback === 'function') callback(job.id) },
  }, label)
  const events = chronology.length ? chronology.map((event, index) => h('li', {
    key: `${event.at ?? 'undated'}-${index}`,
    style: { borderLeft: '2px solid var(--ui-stroke-secondary)', padding: '0 0 13px 12px', marginLeft: '5px' },
  }, h('time', { dateTime: event.at ?? undefined, style: muted }, text(event.at)),
  h('div', { style: { fontWeight: 600, marginTop: '3px' } }, text(event.status)),
  h('div', { style: muted }, redactError(event.error ?? event.message))))
    : [h('li', { key: 'empty', style: muted }, 'Job chronology unavailable.')]

  return h('article', { 'aria-label': 'Job details', style: { display: 'grid', gap: '14px' } },
    h('header', { style: panel },
      h('h2', { style: { margin: '0 0 8px' } }, 'Job details'),
      h('dl', { style: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '5px 12px', margin: 0 } },
        h('dt', { style: muted }, 'Job ID'), h('dd', { style: { margin: 0 } }, text(job.id)),
        h('dt', { style: muted }, 'Status'), h('dd', { style: { margin: 0 } }, text(job.status)),
        h('dt', { style: muted }, 'Created'), h('dd', { style: { margin: 0 } }, text(job.createdAt ?? job.created_at))),
      h('nav', { 'aria-label': 'Job actions', style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        action('Retry', onRetry), action('Pause', onPause), action('Resume', onResume))),
    h('section', { 'aria-label': 'Job chronology', style: panel },
      h('h3', null, 'Chronology'), h('ol', { style: { listStyle: 'none', padding: '8px 0 0', margin: 0 } }, ...events)))
}

