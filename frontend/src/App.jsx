import { useState, useEffect, Fragment } from 'react'
import ComparisonDashboard from './components/ComparisonDashboard'
import ExportHandler from './components/ExportHandler'
import { TrueCostChart, CostBreakdownChart, WalkingDistanceChart } from './components/VisualizationHelper'


function App() {
  // ========== Existing grocery comparison state ==========
  const [items, setItems] = useState([
    { name: '', quantity: 1, baseUnit: '' }
  ])
  const [chains, setChains] = useState([])
  const [selectedChains, setSelectedChains] = useState([])
  const [branchesByChain, setBranchesByChain] = useState({})
  const [productCatalog, setProductCatalog] = useState([])

  // ========== FR07: plan generation ==========

  const [plans, setPlans] = useState([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // User location
  const [userLat, setUserLat] = useState('')
  const [userLng, setUserLng] = useState('')
  const [locationStatus, setLocationStatus] = useState('')

  // Fuel type (still needed for the calculation)
  const [fuelType, setFuelType] = useState('91')

  // ========== FR07: Transport mode (driving / walking) ==========
  const [transportMode, setTransportMode] = useState('driving')
  const [walkingMaxKm, setWalkingMaxKm] = useState(2.0)


  // On page load, fetch supermarket chains and branches
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch supermarket chains
        const chainsRes = await fetch('http://localhost:3000/api/chains?type=supermarket')
        const chainsData = await chainsRes.json()
        setChains(chainsData)
        setSelectedChains(chainsData.map(c => c.chainId))

        // Fetch branches for supermarket chains in parallel
        const branchPromises = chainsData.map(chain =>
          fetch(`http://localhost:3000/api/branches?chainId=${chain.chainId}`)
            .then(res => res.json())
            .then(branches => ({ chainId: chain.chainId, branches }))
        )
        const branchResults = await Promise.all(branchPromises)
        const branchesMap = {}
        branchResults.forEach(({ chainId, branches }) => {
          branchesMap[chainId] = branches
        })
        setBranchesByChain(branchesMap)

        // Fetch product catalog for auto-complete
        const productsRes = await fetch('http://localhost:3000/api/products')
        const productsData = await productsRes.json()
        setProductCatalog(productsData)
      } catch (err) {
        console.error('Failed to fetch initial data:', err)
      }
    }
    fetchData()
  }, [])

  // ========== Helper: geo-locate user ==========
  const getUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation is not supported by your browser')
      return
    }
    setLocationStatus('Getting your location...')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLat(position.coords.latitude.toString())
        setUserLng(position.coords.longitude.toString())
        setLocationStatus(` Detected: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`)
      },
      (error) => {
        setLocationStatus(` Failed: ${error.message}. Please enter coordinates manually.`)
      }
    )
  }

  // ========== Chain toggle handler ==========
  const handleChainToggle = async (chainId) => {
    let newSelected
    if (selectedChains.includes(chainId)) {
      newSelected = selectedChains.filter(s => s !== chainId)
    } else {
      newSelected = [...selectedChains, chainId]
      if (!branchesByChain[chainId]) {
        try {
          const res = await fetch(`http://localhost:3000/api/branches?chainId=${chainId}`)
          const data = await res.json()
          setBranchesByChain(prev => ({ ...prev, [chainId]: data }))
        } catch (err) {
          console.error(`Failed to fetch branches for ${chainId}:`, err)
        }
      }
    }
    setSelectedChains(newSelected)
  }

  // ========== Grocery helpers ==========
  const getBaseUnit = (name) => {
    if (!name.trim()) return ''
    const lowerName = name.trim().toLowerCase()
    const match = productCatalog.find(
      p => p.name.toLowerCase() === lowerName
    )
    return match ? match.baseUnit : ''
  }

  const updateItemName = (index, newName) => {
    const newItems = [...items]
    newItems[index].name = newName
    newItems[index].baseUnit = getBaseUnit(newName)
    setItems(newItems)
  }

  useEffect(() => {
    const savedItems = sessionStorage.getItem('groceryItems')
    if (savedItems) {
      const parsed = JSON.parse(savedItems)
      parsed.forEach(item => {
        item.baseUnit = getBaseUnit(item.name)
      })
      setItems(parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCatalog])

  useEffect(() => {
    sessionStorage.setItem('groceryItems', JSON.stringify(items))
  }, [items])

  // ========== FR07: generate shopping plans ==========
  const generatePlans = async () => {
    // first check if all required fields are filled in


    const itemsArray = items
      .filter(item => item.name.trim() !== '')
      .map(item => ({ name: item.name.trim(), quantity: item.quantity }))

    if (itemsArray.length === 0) {
      setError('Please add at least one grocery item.')
      return
    }
    if (selectedChains.length === 0) {
      setError('Please select at least one supermarket.')
      return
    }
    if (!userLat || !userLng) {
      setError('Please enter your location (latitude and longitude) or use "Use My Location".')
      return
    }

    setLoading(true)
    setError('')
    setPlans([])

    try {
      const body = {
        items: itemsArray,
        supermarkets: selectedChains,
        transportMode: transportMode,
        userLat: parseFloat(userLat),
        userLng: parseFloat(userLng)
      }

      // only include fuelType in driving mode
      if (transportMode === 'driving') {
        body.fuelType = fuelType
      } else {
        // walking mode: send the max walking distance
        body.walkingMaxKm = walkingMaxKm

      }

      const response = await fetch('http://localhost:3000/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Unknown error')
      }

      const data = await response.json()

      // backend returns { plans, message }
      if (data.message) {
        setError(data.message)
        setPlans([])
      } else {
        setPlans(data.plans || data) // fallback for old format

      }
    } catch (err) {
      console.error('Plan generation error:', err)
      setError(`Failed to generate plans: ${err.message}`)

    } finally {
      setLoading(false)
    }
  }

  // ========== Helper: get chain name ==========
  const getChainName = (chainId) => {
    const chain = chains.find(c => c.chainId === chainId)
    return chain ? chain.name : chainId
  }

  // ========== Helper: rank icon ==========
  const getRankIcon = (rank) => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return `#${rank}`
  }

  // ========== Strategy label ==========
  const getStrategyLabel = (plan) => {
    if (plan.strategy === 'single') {
      return `Buy everything at ${plan.stores[0]?.branchName || 'one store'}`
    }
    return `Split between ${plan.stores.length} stores`
  }

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px', wordBreak: 'keep-all', lineHeight: 1.4 }}>🛒 Grocery Saver — Smart Shopping Plans</h1>


      {/* ============================================================ */}
      {/* SECTION 1: Grocery List                                      */}
      {/* ============================================================ */}
      <section style={{ marginBottom: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h2 style={{ marginTop: 0 }}> Your Grocery List</h2>
        {items.map((item, index) => (
          <div key={index} style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="text"
              value={item.name}
              onChange={(e) => updateItemName(index, e.target.value)}
              placeholder="Item name"
              style={{ width: '200px', padding: '5px' }}
            />
            <input
              type="number"
              min="1"
              value={item.quantity}
              onChange={(e) => {
                const newItems = [...items]
                newItems[index].quantity = parseInt(e.target.value) || 1
                setItems(newItems)
              }}
              style={{ width: '60px', padding: '5px' }}
            />
            <span style={{ minWidth: '60px', fontSize: '0.9em', color: '#555' }}>
              {item.baseUnit || ''}
            </span>
            <button
              onClick={() => {
                const newItems = items.filter((_, i) => i !== index)
                setItems(newItems)
              }}
              style={{ padding: '5px 10px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setItems([...items, { name: '', quantity: 1, baseUnit: '' }])}
          style={{ marginTop: '10px', padding: '5px 15px', cursor: 'pointer' }}
        >
          + Add Item
        </button>
      </section>

      {/* ============================================================ */}
      {/* SECTION 2: Supermarket Selection                             */}
      {/* ============================================================ */}
      <section style={{ marginBottom: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h2 style={{ marginTop: 0 }}> Select Supermarkets</h2>
        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-8px' }}>
          {transportMode === 'walking'
            ? 'Pick which supermarket chains you want to consider. The system will find branches within walking distance.'
            : 'Pick which supermarket chains you want to consider. The system will find the closest branch for each chain.'}
        </p>

        {chains.length === 0 ? (
          <span style={{ color: '#888' }}>Loading supermarkets...</span>
        ) : (
          chains.map(chain => (
            <div key={chain.chainId} style={{ marginBottom: '10px' }}>
              <label style={{ marginRight: '15px', fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={selectedChains.includes(chain.chainId)}
                  onChange={() => handleChainToggle(chain.chainId)}
                />
                {chain.name}
              </label>

              {selectedChains.includes(chain.chainId) && branchesByChain[chain.chainId] && (
                <div style={{ marginLeft: '24px', marginTop: '4px', fontSize: '0.9em', color: '#555' }}>
                  <span style={{ fontStyle: 'italic' }}>Available branches:</span>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, listStyle: 'none' }}>
                    {branchesByChain[chain.chainId].map(branch => (
                      <li key={branch.branchId} style={{ marginTop: '2px' }}>
                        • {branch.name} — <span style={{ fontSize: '0.85em' }}>{branch.address}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* ============================================================ */}
      {/* SECTION 3: Settings — Transport Mode + Location               */}
      {/* ============================================================ */}
      <section style={{ marginBottom: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h2 style={{ marginTop: 0 }}> Trip Settings</h2>

        {/* Transport mode toggle */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontWeight: 'bold', marginRight: '16px' }}> Transport Mode:</label>
          <button
            onClick={() => setTransportMode('driving')}
            style={{
              padding: '8px 20px',
              marginRight: '8px',
              cursor: 'pointer',
              backgroundColor: transportMode === 'driving' ? '#007bff' : '#eee',
              color: transportMode === 'driving' ? '#fff' : '#333',
              border: 'none',
              borderRadius: '6px',
              fontWeight: transportMode === 'driving' ? 'bold' : 'normal'
            }}
          >
             Driving
          </button>
          <button
            onClick={() => setTransportMode('walking')}
            style={{
              padding: '8px 20px',
              cursor: 'pointer',
              backgroundColor: transportMode === 'walking' ? '#28a745' : '#eee',
              color: transportMode === 'walking' ? '#fff' : '#333',
              border: 'none',
              borderRadius: '6px',
              fontWeight: transportMode === 'walking' ? 'bold' : 'normal'
            }}
          >
             Walking / Transit
          </button>
        </div>

        {/* Driving mode: Fuel type + efficiency info */}
        {transportMode === 'driving' && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '6px' }}>
            <label style={{ fontWeight: 'bold', marginRight: '12px' }}> Fuel Type:</label>
            <select
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
              style={{ padding: '6px 12px', fontSize: '1em' }}
            >
              <option value="91">91 Octane</option>
              <option value="95">95 Octane</option>
              <option value="diesel">Diesel</option>
            </select>
            <span style={{ marginLeft: '12px', fontSize: '0.9em', color: '#666' }}>
              Fuel efficiency: 10 km/L (NZ average) | We auto-find the cheapest fuel station near you
            </span>
          </div>
        )}

        {/* Walking mode: distance limit */}
        {transportMode === 'walking' && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0fff4', borderRadius: '6px' }}>
            <label style={{ fontWeight: 'bold', marginRight: '12px' }}> Max walking distance:</label>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.5"
              value={walkingMaxKm}
              onChange={(e) => setWalkingMaxKm(parseFloat(e.target.value))}
              style={{ verticalAlign: 'middle', width: '150px' }}
            />
            <span style={{ marginLeft: '10px', fontWeight: 'bold', fontSize: '1em' }}>
              {walkingMaxKm.toFixed(1)} km
            </span>
            <span style={{ marginLeft: '12px', fontSize: '0.9em', color: '#666' }}>
              (~{Math.round(walkingMaxKm / 5 * 60)} min walk one way)
            </span>
          </div>
        )}

        {/* Your location input */}
        <div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}> Latitude:</label>
              <input
                type="text"
                value={userLat}
                onChange={(e) => setUserLat(e.target.value)}
                placeholder="e.g. -41.2865"
                style={{ width: '140px', padding: '5px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}> Longitude:</label>
              <input
                type="text"
                value={userLng}
                onChange={(e) => setUserLng(e.target.value)}
                placeholder="e.g. 174.7762"
                style={{ width: '140px', padding: '5px' }}
              />
            </div>
            <button
              onClick={getUserLocation}
              style={{ padding: '6px 16px', cursor: 'pointer', height: '32px' }}
            >
               Use My Location
            </button>
          </div>
          {locationStatus && (
            <p style={{ fontSize: '0.9em', marginTop: '8px', marginBottom: 0 }}>{locationStatus}</p>
          )}
          <p style={{ fontSize: '0.8em', color: '#888', marginTop: '6px', marginBottom: 0 }}>
            Tip: Wellington city centre is approx Lat -41.2865, Lng 174.7762
          </p>
        </div>
      </section>


      {/* ============================================================ */}
      {/* SECTION 4: Action Button                                     */}
      {/* ============================================================ */}
      <div style={{ marginBottom: '30px' }}>
        <button
          onClick={generatePlans}
          disabled={loading}
          style={{
            padding: '12px 32px',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '1.1em',
            backgroundColor: loading ? '#aaa' : '#28a745',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            opacity: loading ? 0.7 : 1
          }}
        >
        {loading
          ? ' Generating Plans...'
          : transportMode === 'walking'
            ? ' Find Walking Plans'
            : ' Generate Shopping Plans'}

        </button>

        {error && (
          <p style={{ color: '#c00', marginTop: '12px', fontSize: '0.95em' }}>{error}</p>
        )}
      </div>

      {/* ============================================================ */}
      {/* SECTION 5: shopping plans result display (FR07 output + FR09 Dashboard) */}
      {/* ============================================================ */}


      {plans.length > 0 && (
        <section style={{ marginBottom: '30px', border: '2px solid #28a745', borderRadius: '8px', padding: '16px' }}>
          <h2 style={{ marginTop: 0, color: '#28a745' }}> Your Shopping Plans</h2>
          <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-8px', marginBottom: '16px' }}>
            {transportMode === 'walking'
              ? 'Plans are sorted from cheapest to closest. Walking distances and estimated times are shown for each option.'
              : 'We compared all possible shopping strategies for you. Plans are sorted from cheapest to most expensive. Fuel station is auto-recommended — the closest one to your location.'}
          </p>

          {/* FR09: Export toolbar */}
          <ExportHandler plans={plans} />

          {/* FR09: Charts */}
          <TrueCostChart plans={plans} />
          <CostBreakdownChart plans={plans} />
          <WalkingDistanceChart plans={plans} />

          {/* FR09: Side-by-side comparison table */}
          <ComparisonDashboard plans={plans} getChainName={getChainName} />

          {plans.map((plan) => (
            <div
              key={`${plan.strategy}-${plan.stores.map(s => s.chainId).join('-')}-${plan.rank}`}
              style={{
                marginBottom: '20px',
                padding: '16px',
                border: plan.rank === 1 ? '2px solid #28a745' : '1px solid #ddd',
                borderRadius: '8px',
                backgroundColor: plan.rank === 1 ? '#f0fff4' : '#fff'
              }}
            >
              {/* Plan header with rank */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.2em' }}>
                  {getRankIcon(plan.rank)} {getStrategyLabel(plan)}
                  {plan.rank === 1 && (
                    <span style={{
                      marginLeft: '10px',
                      fontSize: '0.8em',
                      backgroundColor: '#28a745',
                      color: '#fff',
                      padding: '2px 10px',
                      borderRadius: '12px'
                    }}>
                      BEST DEAL
                    </span>
                  )}
                </h3>
                <div style={{ fontSize: '1.3em', fontWeight: 'bold', color: plan.rank === 1 ? '#155724' : '#333' }}>
                   ${plan.trueCost.toFixed(2)}
                </div>
              </div>

              {/* Cost breakdown — driving vs walking */}
              {plan.transportMode === 'walking' ? (
                <div style={{ marginTop: '12px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '0.95em' }}>
                  <div>
                    <span style={{ color: '#666' }}>Groceries:</span>{' '}
                    <strong>${plan.groceryTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>Walking distance:</span>{' '}
                    <strong>{plan.roundTripWalkingKm.toFixed(1)} km round trip</strong>
                  </div>
                  {plan.roundTripWalkingTimeMin && (
                    <div>
                      <span style={{ color: '#666' }}>Est. walking time:</span>{' '}
                      <strong>~{plan.roundTripWalkingTimeMin} min total</strong>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: '12px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '0.95em' }}>
                  <div>
                    <span style={{ color: '#666' }}>Groceries:</span>{' '}
                    <strong>${plan.groceryTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>Fuel Cost:</span>{' '}
                    <strong style={{ color: '#c00' }}>${(plan.fuelCost || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>Fuel Price:</span>{' '}
                    <strong>${(plan.fuelPrice || 0).toFixed(2)}/L</strong>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>Total Driving:</span>{' '}
                    <strong>{(plan.routeDistance || 0).toFixed(1)} km</strong>
                  </div>
                </div>
              )}

              {/* Stores involved */}
              <div style={{ marginTop: '12px' }}>
                <strong>🛒 Stores to visit:</strong>
                <div style={{ marginTop: '4px', marginLeft: '8px' }}>
                  {plan.stores.map((store, idx) => (
                    <div key={store.branchId} style={{ marginBottom: '4px' }}>
                      <div style={{ fontWeight: 'bold' }}>
                        {idx + 1}. {getChainName(store.chainId)} — {store.branchName}
                      </div>
                      <div style={{ fontSize: '0.85em', color: '#666', marginLeft: '16px' }}>
                         {store.address}{' '}
                        {plan.transportMode === 'walking'
                          ? `|  ${store.walkingTimeMin ? `~${store.walkingTimeMin} min walk` : `${store.distance.toFixed(1)} km`}`
                          : `|  ${(store.branchDistance || store.distance || 0).toFixed(1)} km from your location`
                        }
                      </div>
                      {store.items && store.items.length > 0 && (
                        <div style={{ fontSize: '0.85em', color: '#555', marginLeft: '16px' }}>
                           Items: {store.items.map(i => i.name).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Route order — only for driving */}
              {plan.transportMode !== 'walking' && plan.route && plan.route.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#555' }}>
                  <strong>Route:</strong> Home {'→'}{' '}
                  {plan.route.map((branchId, idx) => {
                    const store = plan.stores.find(s => s.branchId === branchId)
                    return <Fragment key={branchId}>{store?.branchName || branchId}{idx < plan.route.length - 1 ? ' → ' : ' → Home'}</Fragment>
                  })}
                </div>
              )}

              {/* Walking route info */}
              {plan.transportMode === 'walking' && plan.storeCount > 1 && (
                <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#555' }}>
                  <strong>Walking route:</strong> Home {'→'}{' '}
                  {plan.stores.map((s, idx) => (
                    <Fragment key={s.branchId}>
                      {s.branchName}{idx < plan.stores.length - 1 ? ' → ' : ' → Home'}
                    </Fragment>
                  ))}
                </div>
              )}

              {/* Recommended fuel station — driving only */}
              {plan.recommendedFuelStation && (
                <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#333', padding: '6px 10px', backgroundColor: '#fff3cd', borderRadius: '6px', display: 'inline-block' }}>
                   <strong>Recommended:</strong> {plan.recommendedFuelStation.name}
                  {plan.recommendedFuelStation.address ? ` (${plan.recommendedFuelStation.address})` : ''}
                  {' — '}${plan.recommendedFuelStation.fuelPrice.toFixed(2)}/L
                  {' — '}{plan.recommendedFuelStation.distance.toFixed(1)} km from you
                </div>
              )}

              {/* Item breakdown table */}
              {plan.breakdown && plan.breakdown.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: '0.9em', color: '#007bff' }}>
                       View item breakdown
                    </summary>
                    <table style={{ marginTop: '8px', width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8f9fa' }}>
                          <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'left' }}>Item</th>
                          <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>Qty</th>
                          <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>Unit Price</th>
                          <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>Total</th>
                          <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'left' }}>Store</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.breakdown.map((item, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: '6px', border: '1px solid #ddd' }}>{item.name}</td>
                            <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>{item.quantity}</td>
                            <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>
                              ${item.unitPrice.toFixed(2)}
                            </td>
                            <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>
                              ${item.total.toFixed(2)}
                            </td>
                            <td style={{ padding: '6px', border: '1px solid #ddd' }}>{getChainName(item.store)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}
            </div>
          ))}

          {/* Summary */}
          {plans.length > 0 && (
            <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#e8f5e9', borderRadius: '8px', textAlign: 'center' }}>
              <h3 style={{ margin: 0, color: '#155724' }}>
                 Best plan saves you <strong>${(plans[plans.length - 1].trueCost - plans[0].trueCost).toFixed(2)}</strong> compared to the most expensive option!
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.9em', color: '#666' }}>
                {plans[0].strategy === 'single'
                  ? `Best to shop at ${plans[0].stores[0].branchName} — Total $${plans[0].trueCost.toFixed(2)}`
                  : `Best to split your shopping — Total $${plans[0].trueCost.toFixed(2)}`
                }
              </p>
            </div>
          )}
        </section>
      )}

    </div>
  )
}

export default App
