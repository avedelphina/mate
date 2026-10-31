import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  editor: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  edit: <path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z" />,
  publish: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
}

/**
 * A button of the bar over the page. It has its words, and when the page is narrow the words give
 * way to a picture (see `.act` in styles.css). The words stay as its name for a screen reader.
 */
export function BarButton(props: { icon: keyof typeof PATHS; label: string; title?: string; onClick: () => void }) {
  const { icon, label, title, onClick } = props
  return (
    <button className="quiet act" title={title ?? label} aria-label={label} onClick={onClick}>
      <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {PATHS[icon]}
      </svg>
      <span className="label">{label}</span>
    </button>
  )
}
