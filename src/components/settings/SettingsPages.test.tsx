// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsPages } from './SettingsPages'

afterEach(cleanup)
const pages = [
  { id: 'library', title: 'Memory Library', description: 'Edit memories here.', content: <input aria-label="Memory draft" defaultValue="" /> },
  { id: 'privacy', title: 'Privacy & sources', description: 'Control sources here.', content: <button>Refresh objects</button> },
  { id: 'budgets', title: 'Budgets', description: 'Limits here.', content: <button>Save limits</button> },
]

describe('settings page navigation', () => {
  it('shows one page at a time and preserves an unsaved draft when returning', () => {
    render(<SettingsPages label="Assistant settings" pages={pages} initialPage="library" />)
    fireEvent.change(screen.getByLabelText('Memory draft'), { target: { value: 'Keep my draft' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Privacy & sources' }))
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Privacy & sources')
    expect(screen.queryByRole('textbox', { name: 'Memory draft' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh objects' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Memory Library' }))
    expect(screen.getByRole('textbox', { name: 'Memory draft' })).toHaveValue('Keep my draft')
  })
  it('supports the compact page picker used by narrow windows', () => {
    render(<SettingsPages label="Assistant settings" pages={pages} initialPage="library" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Assistant settings' }), { target: { value: 'budgets' } })
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Budgets')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeVisible()
  })
  it('supports arrow keys, wrapping, Home and End while moving focus to the selected tab', () => {
    render(<SettingsPages label="Assistant settings" pages={pages} initialPage="library" />)
    const library = screen.getByRole('tab', { name: 'Memory Library' })
    library.focus()
    fireEvent.keyDown(library, { key: 'ArrowLeft' })
    const budgets = screen.getByRole('tab', { name: 'Budgets' })
    expect(budgets).toHaveFocus()
    expect(budgets).toHaveAttribute('aria-selected', 'true')
    expect(library).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(budgets, { key: 'ArrowRight' })
    expect(library).toHaveFocus()
    fireEvent.keyDown(library, { key: 'End' })
    expect(budgets).toHaveFocus()
    fireEvent.keyDown(budgets, { key: 'Home' })
    expect(library).toHaveFocus()
  })
})
