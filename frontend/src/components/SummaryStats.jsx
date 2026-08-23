// SummaryStats.jsx — FR09: Summary statistics bar for shopping plans
export default function SummaryStats({ plans }) {
  if (!plans || plans.length < 2) return null

  const worst = plans[plans.length - 1]
  const avgCost = plans.reduce((sum, p) => sum + p.trueCost, 0) / plans.length

  return (
    <div className="summary-stats" aria-label="Comparison summary">
      <div className="summary-stat">
        <span className="summary-label">Highest total</span>
        <span className="summary-value">${worst.trueCost.toFixed(2)}</span>
      </div>
      <div className="summary-stat">
        <span className="summary-label">Average total</span>
        <span className="summary-value">${avgCost.toFixed(2)}</span>
      </div>
      <div className="summary-stat">
        <span className="summary-label">Options compared</span>
        <span className="summary-value">{plans.length}</span>
      </div>
    </div>
  )
}
