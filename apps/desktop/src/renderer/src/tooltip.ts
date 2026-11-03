/**
 * One tooltip for the whole window. The system's own comes late and is not drawn in every part of
 * the window, so a button with a `title` is given this one instead. The title is held back while
 * the pointer is over the button, so the system shows nothing, and put back when it leaves.
 */
export function showTooltips(): void {
  const tip = document.createElement('div')
  tip.className = 'tip'
  tip.setAttribute('popover', 'manual') // the top layer, so it also shows over a dialog
  tip.setAttribute('aria-hidden', 'true') // the button names itself for a screen reader
  document.body.append(tip)

  let on: HTMLElement | null = null
  let held = ''
  let timer = 0

  const hide = () => {
    clearTimeout(timer)
    if (on && held) on.title = held
    on = null
    if (tip.matches(':popover-open')) tip.hidePopover()
  }

  document.addEventListener('pointerover', (event) => {
    const from = (event.target as Element).closest?.<HTMLElement>('[title]') ?? null
    if (from === on) return
    hide()
    if (!from || !from.title) return
    on = from
    held = from.title
    from.removeAttribute('title')
    timer = window.setTimeout(() => {
      tip.textContent = held
      tip.showPopover()
      const at = from.getBoundingClientRect()
      const box = tip.getBoundingClientRect()
      const left = Math.min(Math.max(8, at.left + at.width / 2 - box.width / 2), innerWidth - box.width - 8)
      const below = at.bottom + 8 + box.height <= innerHeight
      tip.style.left = `${left}px`
      tip.style.top = `${below ? at.bottom + 8 : at.top - 8 - box.height}px`
    }, 400)
  })
  document.addEventListener('pointerleave', hide)
  for (const type of ['pointerdown', 'keydown', 'wheel', 'blur']) addEventListener(type, hide, true)
}
