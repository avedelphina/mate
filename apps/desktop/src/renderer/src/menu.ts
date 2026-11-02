import type { MouseEvent } from 'react'

/** One item of a menu: its words, what it does, and whether it can be chosen now. `null` is a line between items. */
export type Item = { label: string; run: () => void; enabled?: boolean } | null

/**
 * Show a menu of the system, and do what the reader chose from it. With `under`, the button that
 * was pressed, it drops from that button as a Mac toolbar menu does; else it opens at the pointer.
 */
export async function popMenu(items: Item[], under?: Element): Promise<void> {
  const box = under?.getBoundingClientRect()
  const at = box && { x: box.left, y: box.bottom + 4 }
  const chosen = await window.mate.menu(items.map((item, index) => item && { id: String(index), label: item.label, enabled: item.enabled }), at)
  if (chosen !== null) items[Number(chosen)]?.run()
}

/** A button that drops a menu of the system from itself. */
export const dropMenu = (items: () => Item[]) => ({ onClick: (event: MouseEvent) => void popMenu(items(), event.currentTarget) })

/** A right click that shows these items in place of the system's own menu. */
export const onRightClick = (items: () => Item[]) => ({
  onContextMenu: (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void popMenu(items())
  }
})
