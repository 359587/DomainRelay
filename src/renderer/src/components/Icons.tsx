import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const defaults: IconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
}

export function RouteIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.9 10h16.2M3.9 14h16.2M12 3.75c2.1 2.25 3.2 5 3.2 8.25S14.1 18 12 20.25C9.9 18 8.8 15.25 8.8 12S9.9 6 12 3.75Z" />
      <circle cx="5" cy="6" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="19" cy="18" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SystemIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M8.5 10.5a5 5 0 0 1 7 0M10.5 12.5a2.2 2.2 0 0 1 3 0M12 14.5h.01" />
    </svg>
  )
}

export function ServerIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" />
    </svg>
  )
}

export function DomainIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17M3.5 15h17M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z" />
    </svg>
  )
}

export function TestIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 12h3l2-5 4 10 2-5h5" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

export function TrafficIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 17V7m0 0L1.5 9.5M4 7l2.5 2.5M20 7v10m0 0-2.5-2.5M20 17l2.5-2.5" />
      <path d="M9 17V11h3v6m0 0V7h3v10" />
    </svg>
  )
}

export function ApplicationIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
      <path d="m9 13 2 2-2 2m4 0h3" />
    </svg>
  )
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  )
}

export function MoreIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M20 6v5h-5" />
      <path d="M18.4 16a8 8 0 1 1 .6-8l1 3" />
    </svg>
  )
}

export function ImportIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 15v5h16v-5" />
    </svg>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
    </svg>
  )
}

export function EyeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 6h7l2 2h9v10H3V6Z" />
    </svg>
  )
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...defaults} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}
