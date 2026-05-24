// SummaryStats.jsx — FR09: Summary statistics bar for shopping plans
export default function SummaryStats({ plans }) {
  if (!plans || plans.length === 0) return null

  const best = plans[0]
  const worst = plans[plans.length - 1]
  const savings = worst.trueCost - best.trueCost
  const avgCost = plans.reduce((sum, p) => sum + p.trueCost, 0) / plans.length

  const boxStyle = {
    flex: '1',
    minWidth: '150px',
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '12px 16px',
    textAlign: 'center'
  }

  const labelStyle = {
    fontSize: '0.8em',
    color: '#888',
    marginBottom: '4px'
  }

  const valueStyle = {
    fontSize: '1.4em',
    fontWeight: 'bold',
    color: '#155724'
  }

  return (
    <div style={{ marginBottom: '20px' }}>
      <h4 style={{ margin: '0 0 10px', fontSize: '1em' }}>📊 Summary</h4>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={boxStyle}>
          <div style={labelStyle}>Best Plan</div>
          <div style={valueStyle}>${best.trueCost.toFixed(2)}</div>
        </div>
        <div style={boxStyle}>
          <div style={labelStyle}>Most Expensive</div>
          <div style={{ ...valueStyle, color: '#c00' }}>${worst.trueCost.toFixed(2)}</div>
        </div>
        <div style={boxStyle}>
          <div style={labelStyle}>You Save</div>
          <div style={{ ...valueStyle, color: '#007bff' }}>${savings.toFixed(2)}</div>
        </div>
        <div style={boxStyle}>
          <div style={labelStyle}>Avg Plan Cost</div>
          <div style={{ ...valueStyle, color: '#555' }}>${avgCost.toFixed(2)}</div>
        </div>
        <div style={boxStyle}>
          <div style={labelStyle}>Plans Compared</div>
          <div style={{ ...valueStyle, color: '#555' }}>{plans.length}</div>
        </div>
      </div>
    </div>
  )
}