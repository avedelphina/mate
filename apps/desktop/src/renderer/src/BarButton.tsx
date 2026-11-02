import { Icon, type IconName } from './Icon'

/**
 * A button of the bar over the page: a picture, as in the toolbar of a Mac app. Its words are its
 * name for a screen reader and its tooltip.
 */
export function BarButton(props: { icon: IconName; label: string; title?: string; onClick: () => void; fit?: boolean }) {
  const { icon, label, title, onClick, fit = false } = props
  return (
    <button className={fit ? 'quiet act fit' : 'quiet act'} title={title ?? label} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={17} />
      <span className="label">{label}</span>
    </button>
  )
}
