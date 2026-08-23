// ExportHandler.jsx — FR09: CSV export + print + localStorage persistence
import { useEffect } from 'react'

// Save latest plans to localStorage so they survive page refresh
export const savePlansToStorage = (plans) => {
  try {
    localStorage.setItem('grocerySaver_plans', JSON.stringify(plans))
  } catch { /* ignore quota errors */ }
}

export const loadPlansFromStorage = () => {
  try {
    const raw = localStorage.getItem('grocerySaver_plans')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Generate a CSV string from plans array
export const plansToCSV = (plans) => {
  const headers = ['Rank', 'Strategy', 'Stores', 'Grocery Total', 'Fuel Cost', 'True Cost', 'Distance (km)', 'Store Count']
  const rows = plans.map(p => [
    p.rank,
    p.strategy === 'single' ? 'Single store' : 'Split',
    p.stores.map(s => s.branchName).join(' + '),
    p.groceryTotal?.toFixed(2) || '',
    p.fuelCost?.toFixed(2) || '0.00',
    p.trueCost?.toFixed(2) || '',
    p.transportMode === 'walking'
      ? (p.roundTripWalkingKm || p.walkingDistance || 0).toFixed(1)
      : (p.routeDistance || 0).toFixed(1),
    p.storeCount || p.stores.length
  ])

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  return csvContent
}

// Trigger CSV file download
export const downloadCSV = (plans, filename = 'shopping_plans.csv') => {
  const csv = plansToCSV(plans)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// React component: toolbar with export buttons
export default function ExportHandler({ plans }) {
  // Persist to localStorage whenever plans change
  useEffect(() => {
    if (plans && plans.length > 0) {
      savePlansToStorage(plans)
    }
  }, [plans])

  const handlePrint = () => window.print()

  return (
    <div className="export-toolbar" aria-label="Result actions">
      <button className="export-button" onClick={() => downloadCSV(plans)}>
        Export CSV
      </button>
      <button className="export-button" onClick={handlePrint}>
        Print
      </button>
    </div>
  )
}
