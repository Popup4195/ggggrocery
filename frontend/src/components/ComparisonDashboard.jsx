import { useState } from 'react'

const getDistance = (plan) => {
  if (plan.transportMode === 'walking') {
    return plan.roundTripWalkingKm || plan.walkingDistance || 0
  }
  return plan.routeDistance || 0
}

export default function ComparisonDashboard({ plans, getChainName }) {
  const [sortKey, setSortKey] = useState('rank')
  const [sortAsc, setSortAsc] = useState(true)

  if (!plans || plans.length < 2) return null

  const getSortValue = (plan, key) => {
    if (key === 'trueCost') return plan.trueCost
    if (key === 'groceryTotal') return plan.groceryTotal
    if (key === 'fuelCost') return plan.fuelCost || 0
    if (key === 'distance') return getDistance(plan)
    if (key === 'storeCount') return plan.storeCount || plan.stores.length
    return plan.rank
  }

  const sorted = [...plans].sort((a, b) => {
    const difference = getSortValue(a, sortKey) - getSortValue(b, sortKey)
    return sortAsc ? difference : -difference
  })

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortLabel = (key) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  return (
    <div className="comparison-dashboard">
      <h4 className="comparison-title">
        Side-by-side details <span>Select a heading to sort</span>
      </h4>
      <div className="table-scroll">
        <table className="comparison-table">
          <thead>
          <tr>
            <th className="sortable align-center" onClick={() => handleSort('rank')}>
              Rank{sortLabel('rank')}
            </th>
            <th>Plan</th>
            <th className="sortable align-right" onClick={() => handleSort('groceryTotal')}>
              Groceries{sortLabel('groceryTotal')}
            </th>
            <th className="sortable align-right" onClick={() => handleSort('fuelCost')}>
              Fuel{sortLabel('fuelCost')}
            </th>
            <th className="sortable align-right" onClick={() => handleSort('trueCost')}>
              Total{sortLabel('trueCost')}
            </th>
            <th className="sortable align-right" onClick={() => handleSort('distance')}>
              Distance{sortLabel('distance')}
            </th>
            <th className="sortable align-center" onClick={() => handleSort('storeCount')}>
              Stores{sortLabel('storeCount')}
            </th>
          </tr>
          </thead>
          <tbody>
          {sorted.map(plan => (
            <tr key={plan.rank} className={plan.rank === 1 ? 'best-column' : ''}>
              <td className="align-center">#{plan.rank}</td>
              <td>
                <strong>{plan.strategy === 'single' ? 'One store' : 'Split trip'}</strong>
                <div className="matched-name">
                  {plan.stores.map(store => getChainName ? getChainName(store.chainId) : store.chainId).join(' + ')}
                </div>
              </td>
              <td className="align-right">${plan.groceryTotal.toFixed(2)}</td>
              <td className="align-right">
                {plan.transportMode === 'walking' ? '—' : `$${(plan.fuelCost || 0).toFixed(2)}`}
              </td>
              <td className="align-right"><strong>${plan.trueCost.toFixed(2)}</strong></td>
              <td className="align-right">{getDistance(plan).toFixed(1)} km</td>
              <td className="align-center">{plan.storeCount || plan.stores.length}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
