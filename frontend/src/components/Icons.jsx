import newWorldLogo from '../assets/new-world-logo.png'
import paknSaveLogo from '../assets/paknsave-logo.png'
import woolworthsLogo from '../assets/woolworths-logo.jpg'

const IconBase = ({ children, className = '' }) => (
  <svg
    className={`ui-icon${className ? ` ${className}` : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export function GroceryListIcon() {
  return (
    <IconBase>
      <path d="M4 10h16l-1.2 8.1a2 2 0 0 1-2 1.7H7.2a2 2 0 0 1-2-1.7L4 10Z" />
      <path d="m8 10 4-6 4 6M9 14v2.5M15 14v2.5" />
    </IconBase>
  )
}

export function SupermarketIcon() {
  return (
    <IconBase>
      <path d="M4 10v10h16V10M3 10l2-6h14l2 6" />
      <path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2M9 20v-5h6v5" />
    </IconBase>
  )
}

export function TripIcon() {
  return (
    <IconBase>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18c5.5 0 1.5-12 7-12" />
    </IconBase>
  )
}

export function LocationIcon() {
  return (
    <IconBase>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </IconBase>
  )
}

export function FuelIcon() {
  return (
    <IconBase>
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14" />
      <path d="M8 7h4v5H8zM15 6l3 3v8.5a1.5 1.5 0 0 0 3 0V12h-2" />
    </IconBase>
  )
}

export function PlanIcon() {
  return (
    <IconBase>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h4M8.5 18h6" />
    </IconBase>
  )
}

export function ShareIcon() {
  return (
    <IconBase>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
    </IconBase>
  )
}

export function GenerateIcon() {
  return (
    <IconBase>
      <path d="m12 3 1.1 3.1L16 7.2l-2.9 1.1L12 11.5l-1.1-3.2L8 7.2l2.9-1.1L12 3ZM18.5 13l.7 2 .8.3-.8.3-.7 2-.7-2-.8-.3.8-.3.7-2ZM6 13l1.1 3.1L10 17.2l-2.9 1.1L6 21.5l-1.1-3.2L2 17.2l2.9-1.1L6 13Z" />
    </IconBase>
  )
}

export function ExportIcon() {
  return (
    <IconBase>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 15v5h14v-5" />
    </IconBase>
  )
}

export function PrintIcon() {
  return (
    <IconBase>
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" />
      <path d="M17.5 11.5h.01" />
    </IconBase>
  )
}

export function RecommendedIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </IconBase>
  )
}

export function SupermarketLogo({ name }) {
  const normalizedName = String(name ?? '').toLowerCase()
  let logo = null

  if (normalizedName.includes('countdown') || normalizedName.includes('woolworths')) {
    logo = woolworthsLogo
  } else if (normalizedName.includes('new world')) {
    logo = newWorldLogo
  } else if (normalizedName.includes("pak'n") || normalizedName.includes('pak n')) {
    logo = paknSaveLogo
  }

  if (logo) {
    return (
      <span className="supermarket-logo supermarket-logo-image" aria-hidden="true">
        <img src={logo} alt="" />
      </span>
    )
  }

  const fallbackMark = String(name ?? '').trim().charAt(0).toUpperCase() || 'S'
  return <span className="supermarket-logo supermarket-logo-generic" aria-hidden="true">{fallbackMark}</span>
}
