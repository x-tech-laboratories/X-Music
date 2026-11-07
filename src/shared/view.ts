// The filter stack, framework-free: plain TypeScript with no reactivity primitives, so a second front
// end can reuse it unchanged. Selection, sorting and virtualization come from X-Libs.

import { and, isGroup, type FilterNode } from './filter'

export interface FilterChip {
  id: string
  label: string
  node: FilterNode
  removable: boolean
}

/**
 * The visible query, expressed as a stack of removable chips. The stack IS the filter AST, which is
 * what lets any browse state be saved as a smart playlist unchanged.
 */
export class FilterStack {
  private chips: FilterChip[] = []
  version = 0

  list(): readonly FilterChip[] { return this.chips }

  push(chip: FilterChip): void {
    this.chips = [...this.chips.filter((c) => c.id !== chip.id), chip]
    this.version++
  }

  remove(id: string): void {
    this.chips = this.chips.filter((c) => c.id !== id)
    this.version++
  }

  clear(): void { this.chips = this.chips.filter((c) => !c.removable); this.version++ }

  /** Collapses the stack into a single AST; an empty stack means the whole library. */
  toFilter(): FilterNode {
    const nodes = this.chips.map((c) => c.node).filter((n) => !(isGroup(n) && n.children.length === 0))
    return nodes.length === 1 ? nodes[0]! : and(...nodes)
  }
}
