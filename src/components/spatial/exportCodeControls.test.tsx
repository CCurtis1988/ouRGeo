// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  ToggleRow,
  NumericField,
  FontFaceGroup,
  AlignGroup,
  PositionControl,
} from './exportCodeControls'

describe('ToggleRow', () => {
  it('renders its label and toggles the current value on click', () => {
    const onChange = vi.fn()
    render(<ToggleRow label="Show frame" checked={false} onChange={onChange} />)
    expect(screen.getByText('Show frame')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('NumericField', () => {
  it('clamps entered values into the [min, max] range', () => {
    const onChange = vi.fn()
    render(<NumericField label="Size" value={5} min={0} max={10} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '20' } })
    expect(onChange).toHaveBeenLastCalledWith(10)
    fireEvent.change(input, { target: { value: '-4' } })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })
})

describe('FontFaceGroup / AlignGroup', () => {
  it('reports the chosen font face', () => {
    const onChange = vi.fn()
    render(<FontFaceGroup value="plain" onChange={onChange} />)
    fireEvent.click(screen.getByText('Bold'))
    expect(onChange).toHaveBeenCalledWith('bold')
  })
  it('reports the chosen alignment', () => {
    const onChange = vi.fn()
    render(<AlignGroup value="left" onChange={onChange} />)
    fireEvent.click(screen.getByText('C'))
    expect(onChange).toHaveBeenCalledWith('center')
  })
})

describe('PositionControl', () => {
  it('reports the clicked grid position', () => {
    const onChange = vi.fn()
    render(<PositionControl value="top-left" onChange={onChange} />)
    fireEvent.click(screen.getByText('↗'))
    expect(onChange).toHaveBeenCalledWith('top-right')
  })
})
