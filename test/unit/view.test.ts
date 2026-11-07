import { describe, expect, it } from 'vitest'
import { FilterStack } from '@shared/view'
import { leaf, and, isGroup } from '@shared/filter'

describe('filter stack', () => {
  it('collapses to a single AST', () => {
    const st = new FilterStack()
    st.push({ id: 'genre', label: 'Jazz', node: leaf('genre', 'any', ['Jazz']), removable: true })
    st.push({ id: 'rating', label: '4+', node: leaf('rating', '>=', 80), removable: true })

    const f = st.toFilter()
    expect(isGroup(f) && f.op === 'and').toBe(true)
    expect(isGroup(f) && f.children).toHaveLength(2)
  })

  it('replaces a chip with the same id rather than stacking duplicates', () => {
    const st = new FilterStack()
    st.push({ id: 'genre', label: 'Jazz', node: leaf('genre', 'any', ['Jazz']), removable: true })
    st.push({ id: 'genre', label: 'Rock', node: leaf('genre', 'any', ['Rock']), removable: true })
    expect(st.list()).toHaveLength(1)
    expect(st.list()[0]!.label).toBe('Rock')
  })

  it('keeps non-removable chips when cleared', () => {
    const st = new FilterStack()
    st.push({ id: 'root', label: 'Library', node: and(), removable: false })
    st.push({ id: 'genre', label: 'Jazz', node: leaf('genre', 'any', ['Jazz']), removable: true })
    st.clear()
    expect(st.list()).toHaveLength(1)
    expect(st.list()[0]!.id).toBe('root')
  })
})
