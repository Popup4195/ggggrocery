import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, Cell, CartesianGrid
} from 'recharts'

const COLORS = ['#28a745', '#007bff', '#ffc107', '#dc3545', '#6f42c1', '#fd7e14']

function calcBreakAxis(values) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min
  const shouldBreak = max > 0 && min > 0 && max / min < 1.5
  if (!shouldBreak) {
    return { shouldBreak: false, botMax: 0, topMin: 0, topMax: max * 1.08 }
  }
  const botMax = Math.floor(min * 0.97 * 100) / 100
  const topMin = botMax
  const topMax = Math.ceil((max + spread * 0.3) * 100) / 100
  return { shouldBreak, botMax, topMin, topMax }
}

function BreakSymbol() {
  return (
      <div style={{ display: 'flex', alignItems: 'center', margin: '1px 16px 1px 48px' }}>
        <div style={{ flex: 1, borderTop: '1px dashed #ddd' }} />
        <span style={{ fontSize: 9, color: '#ccc', padding: '0 4px', whiteSpace: 'nowrap' }}>|</span>
        <div style={{ flex: 1, borderTop: '1px dashed #ddd' }} />
      </div>
  )
}

// ─────────────────────────────────────────────
// Chart 1: True Cost comparison (支持断轴)
// ─────────────────────────────────────────────
export function TrueCostChart({ plans }) {
  if (!plans || plans.length === 0) return null

  const data = plans.map((p, idx) => ({
    name: `#${p.rank} ${p.stores.map(s => s.branchName.split(' ')[0]).join('+')}`,
    trueCost: p.trueCost || 0,
    fill: idx === 0 ? '#28a745' : COLORS[idx % COLORS.length],
  }))

  const values = data.map(d => d.trueCost)
  const { shouldBreak, botMax, topMin, topMax } = calcBreakAxis(values)

  if (!shouldBreak) {
    return (
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '1em' }}> True Cost Comparison</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={value => [`$${value.toFixed(2)}`, 'True Cost']} />
              <Bar dataKey="trueCost" radius={[6, 6, 0, 0]}>
                {data.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
    )
  }

  const totalHeight = 220
  const topHeight = Math.round(totalHeight * 0.70)
  const botHeight = Math.round(totalHeight * 0.30)
  const sharedMargin = { top: 4, right: 16, left: 0, bottom: 0 }

  return (
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '1em' }}> True Cost Comparison</h4>

        <ResponsiveContainer width="100%" height={topHeight}>
          <BarChart data={data} margin={{ ...sharedMargin, top: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
            <YAxis
                domain={[topMin, topMax]}
                tick={{ fontSize: 11 }}
                tickFormatter={v => `$${v.toFixed(2)}`}
                tickCount={4}
            />
            <Tooltip formatter={value => [`$${value.toFixed(2)}`, 'True Cost']} />
            <Bar dataKey="trueCost" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {data.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <BreakSymbol />

        <ResponsiveContainer width="100%" height={botHeight}>
          <BarChart data={data} margin={{ ...sharedMargin, bottom: 8 }}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={true} />
            <YAxis
                domain={[0, botMax]}
                tick={{ fontSize: 11 }}
                tickFormatter={v => `$${v}`}
                tickCount={3}
            />
            <Bar dataKey="trueCost" radius={0} isAnimationActive={false}>
              {data.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} fillOpacity={0.2} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
  )
}

// ─────────────────────────────────────────────
// Chart 2: Cost breakdown stacked bars
// ─────────────────────────────────────────────
export function CostBreakdownChart({ plans }) {
  if (!plans || plans.length === 0) return null

  const data = plans.map(p => ({
    name: `#${p.rank}`,
    Groceries: p.groceryTotal || 0,
    Fuel: p.fuelCost || 0
  }))

  return (
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '1em' }}> Cost Breakdown (Groceries vs Fuel)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(value) => [`$${value.toFixed(2)}`, '']} />
            <Legend />
            <Bar dataKey="Groceries" stackId="a" fill="#28a745" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Fuel" stackId="a" fill="#dc3545" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
  )
}

// ─────────────────────────────────────────────
// Chart 3: Walking distance comparison (if walking mode)
// ─────────────────────────────────────────────
export function WalkingDistanceChart({ plans }) {
  if (!plans || plans.length === 0) return null
  const isWalking = plans.some(p => p.transportMode === 'walking')
  if (!isWalking) return null

  const data = plans.map(p => ({
    name: `#${p.rank}`,
    distance: p.roundTripWalkingKm || p.walkingDistance || 0,
    time: p.roundTripWalkingTimeMin || 0
  }))

  return (
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '1em' }}>🚶 Walking Distance & Time</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} km`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} min`} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="distance" name="Round trip (km)" fill="#17a2b8" radius={[6, 6, 0, 0]} />
            <Bar yAxisId="right" dataKey="time" name="Est. time (min)" fill="#ffc107" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
  )
}
