import React from 'react'
export const Button = ({ children, variant, ...props }) => React.createElement('button', { ...props, 'data-variant': variant }, children)
export const Badge = ({ children, ...props }) => React.createElement('span', props, children)
export const EmptyState = ({ title, description, children }) => React.createElement('section', null, React.createElement('h2', null, title), React.createElement('p', null, description), children)
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const PALETTE_AREA = 'commandPalette'
export const host = { navigate: () => {} }
