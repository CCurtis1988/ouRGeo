// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VarChip, GeomButton } from './chartBuilderControls'

describe('VarChip', () => {
  it('shows the column name and inferred type badge, and fires onClick', () => {
    const onClick = vi.fn()
    render(<VarChip col={{ name: 'pop', type: 'numeric' }} onClick={onClick} />)
    expect(screen.getByText('pop')).toBeInTheDocument()
    expect(screen.getByText('num')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('pop (numeric)'))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('GeomButton', () => {
  it('renders the geom label and fires onClick', () => {
    const onClick = vi.fn()
    render(<GeomButton geom="point" selected={false} state="available" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
    expect(screen.getByText('Scatter')).toBeInTheDocument()
  })
})
