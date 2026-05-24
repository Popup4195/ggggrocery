// ComparisonDashboard.jsx — FR09: side-by-side table for all plans
import { useState } from 'react'

// Sorting keys and their labels
const SORT_KEYS = {
  rank: 'Rank',
  trueCost: 'True Cost',
  groceryTotal: 'Grocery Total',
  fuelCost: 'Fuel Cost',
  distance: 'Distance',
  storeCount: 'Stores'
}

// Helper: get numeric distance from a plan
const getDistance = (p) => {
  if (p.transportMode === 'walking') return p.roundTripWalkingKm || p.walkingDistance || 0
  return p.routeDistance || 0
}

export default function ComparisonDashboard({ plans, getChainName }) {
  const [sortKey, setSortKey] = useState('rank')
  const [sortAsc, setSortAsc] = useState(true)

  if (!plans || plans.length === 0) return null

  const sorted = [...plans].sort((a, b) => {
    let va, vb
    if (sortKey === 'trueCost') { va = a.trueCost; vb = b.trueCost }
    else if (sortKey === 'groceryTotal') { va = a.groceryTotal; vb = b.groceryTotal }
    else if (sortKey === 'fuelCost') { va = a.fuelCost || 0; vb = b.fuelCost || 0 }
    else if (sortKey === 'distance') { va = getDistance(a); vb = getDistance(b) }
    else if (sortKey === 'storeCount') { va = a.storeCount || a.stores.length; vb = b.storeCount || b.stores.length }
    else { va = a.rank; vb = b.rank }
    return sortAsc ? va - vb : vb - va
  })

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const SortIcon = ({ active, asc }) =>
    active ? <span style={{ fontSize: '0.75em' }}> {asc ? '▲' : '▼'}</span> : null

  const cellStyle = { padding: '8px 10px', border: '1px solid #ddd', textAlign: 'center', fontSize: '0.9em' }
  const headerStyle = { ...cellStyle, backgroundColor: '#f8f9fa', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }

  const format = (v) => (v ?? 0).toFixed(2)

  return (
    <div style={{ marginBottom: '24px', overflowX: 'auto' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: '1em' }}> Side-by-Side Comparison <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: '#888' }}>(click headers to sort)</span></h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <thead>
          <tr>
            <td style={headerStyle} onClick={() => handleSort('rank')}>
              Rank<SortIcon active={sortKey === 'rank'} asc={sortAsc} />
            </td>
            <td style={{ ...headerStyle, cursor: 'default' }}>Strategy</td>
            {sorted.map(p => (
              <th key={p.rank} style={{ ...cellStyle, backgroundColor: p.rank === 1 ? '#f0fff4' : '#f8f9fa', fontWeight: p.rank === 1 ? 'bold' : 'normal' }}>
                {p.rank === 1 ? '🥇 ' : p.rank === 2 ? '🥈 ' : p.rank === 3 ? '🥉 ' : `#${p.rank} `}
                {p.stores.map(s => s.branchName.split(' ')[0]).join(' + ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Grocery Total */}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left' }} onClick={() => handleSort('groceryTotal')}>
              Groceries<SortIcon active={sortKey === 'groceryTotal'} asc={sortAsc} />
            </td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={cellStyle}>${format(p.groceryTotal)}</td>
            ))}
          </tr>
          {/* Fuel Cost */}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left' }} onClick={() => handleSort('fuelCost')}>
              Fuel<SortIcon active={sortKey === 'fuelCost'} asc={sortAsc} />
            </td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={{ ...cellStyle, color: p.fuelCost ? '#c00' : '#999' }}>
                {p.fuelCost ? `$${format(p.fuelCost)}` : '—'}
              </td>
            ))}
          </tr>
          {/* True Cost */}
          <tr style={{ backgroundColor: '#f9fff9' }}>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left' }} onClick={() => handleSort('trueCost')}>
              True Cost<SortIcon active={sortKey === 'trueCost'} asc={sortAsc} />
            </td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={{ ...cellStyle, fontWeight: 'bold', color: p.rank === 1 ? '#155724' : '#333' }}>
                ${format(p.trueCost)}
              </td>
            ))}
          </tr>
          {/* Distance */}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left' }} onClick={() => handleSort('distance')}>
              Distance<SortIcon active={sortKey === 'distance'} asc={sortAsc} />
            </td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={cellStyle}>
                {getDistance(p).toFixed(1)} km
              </td>
            ))}
          </tr>
          {/* Store Count */}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left' }} onClick={() => handleSort('storeCount')}>
              Stores<SortIcon active={sortKey === 'storeCount'} asc={sortAsc} />
            </td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={cellStyle}>{p.storeCount || p.stores.length}</td>
            ))}
          </tr>
          {/* Strategy label row */}
          <tr>
            <td
              colSpan={2}
              style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left', cursor: 'default' }}
            >
              Strategy — {sorted[0]?.strategy === 'single' ? 'One store' : 'Split'}
              {sorted[0]?.transportMode === 'walking' ? ' walk' : ' drive'}
            </td>
            {sorted.map(p => (
              <td key={p.rank} style={cellStyle}>
                {p.strategy === 'single' ? 'One store' : 'Split'}
                {p.transportMode === 'walking' ? ' walk' : ' drive'}
              </td>
            ))}
          </tr>


          {/* Stores detail */}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'left', cursor: 'default' }}>Stores to visit</td>
            <td style={cellStyle}>—</td>
            {sorted.map(p => (
              <td key={p.rank} style={{ ...cellStyle, textAlign: 'left', fontSize: '0.85em', lineHeight: 1.5 }}>
                {p.stores.map(s => (
                  <div key={s.branchId}>
                    <strong>{getChainName ? getChainName(s.chainId) : s.chainId}</strong> — {s.branchName}
                  </div>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
