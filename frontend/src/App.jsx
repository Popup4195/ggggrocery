import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import ComparisonDashboard from './components/ComparisonDashboard'
import ExportHandler from './components/ExportHandler'
import { TrueCostChart, CostBreakdownChart, WalkingDistanceChart } from './components/VisualizationHelper'
import SummaryStats from './components/SummaryStats'
import { getPurchaseSelection } from './utils/purchaseUnit'
import './App.css'


function App() {
  // ========== Existing grocery comparison state ==========
  const [items, setItems] = useState([
    { name: '', quantity: 1, baseUnit: '', query: '', category: null, confirmed: false }
  ])
  const [chains, setChains] = useState([])
  const [selectedChains, setSelectedChains] = useState([])
  const [branchesByChain, setBranchesByChain] = useState({})
  const [productCatalog, setProductCatalog] = useState([])

  // ========== FR-S1: shareable list links (guest mode) ==========
  // sharedListId is only set once a list has been successfully created (Share button)
  // or successfully loaded from a ?list=<id> link. While it's set, edits to `items`
  // get PUT back to the backend so anyone else viewing the same link stays in sync.
  const [sharedListId, setSharedListId] = useState(null)
  const [listLoading, setListLoading] = useState(false)
  const [listLoadError, setListLoadError] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState('')
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const listFetchAttempted = useRef(false)
  const activeEditRef = useRef(false) // true while a list-item input is focused — skip poll updates then
  const skipNextSyncRef = useRef(false) // true right after we apply server data locally, so we don't PUT it straight back

  // ========== FR07: plan generation ==========

  const [plans, setPlans] = useState([])
  const [globallyUnavailableItems, setGloballyUnavailableItems] = useState([])

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
        const chainsRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/chains?type=supermarket`)
        const chainsData = await chainsRes.json()
        setChains(chainsData)
        // FR-S1: if we're loading a shared list, its own selectedChains (loaded by the
        // shared-list effect below) should win — selecting everything here first would
        // otherwise race with that load and clobber whichever one resolves last.
        if (!new URLSearchParams(window.location.search).get('list')) {
          setSelectedChains(chainsData.map(c => c.chainId))
        }

        // Fetch branches for supermarket chains in parallel
        const branchPromises = chainsData.map(chain =>
            fetch(`${import.meta.env.VITE_API_BASE_URL}/api/branches?chainId=${chain.chainId}`)
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
        const productsRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/products`)
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
          const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/branches?chainId=${chainId}`)
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
    return match ? getPurchaseSelection(match).baseUnit : ''
  }

  const updateItemName = (index, newName) => {
    const newItems = [...items]
    newItems[index].name = newName
    // "query" is what actually gets sent to the backend for price lookup at every store.
    // While the user is free-typing, it stays in sync with the displayed text.
    newItems[index].query = newName
    newItems[index].baseUnit = getBaseUnit(newName)
    // Free-text editing invalidates any previous confirmed selection —
    // the item goes back to "unconfirmed" until the user picks from the dropdown again.
    newItems[index].confirmed = false
    setItems(newItems)
  }

  // ========== Autocomplete dropdown (search-as-you-type product suggestions) ==========
  // activeSuggestionIndex: which grocery-list row currently has its dropdown open (null = none)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(null)

  // Precompute a lowercased name for each catalog product so filtering while typing
  // doesn't re-lowercase the whole catalog on every keystroke.
  const catalogIndex = useMemo(
      () => productCatalog.map(p => ({ ...p, _lower: p.name.toLowerCase() })),
      [productCatalog]
  )

  const getSuggestions = (rawName) => {
    const lowerName = rawName.trim().toLowerCase()
    if (!lowerName) return []
    return catalogIndex.filter(p => p._lower.includes(lowerName))
  }

  const selectSuggestion = (index, product) => {
    const newItems = [...items]
    const purchaseSelection = getPurchaseSelection(product)
    // The displayed name always becomes the confirmed catalog product. Variable-weight
    // and existing count-unit products keep the current loose query for cross-store matching;
    // an explicitly packaged product uses its full selected name as the lookup query below.
    newItems[index].name = product.name
    newItems[index].baseUnit = purchaseSelection.baseUnit
    // A confirmed fixed package must use its complete selected product name as the
    // lookup query. For variable-weight and existing count-unit products, preserve
    // the current loose-query behaviour unchanged.
    if (purchaseSelection.useExactQuery) newItems[index].query = product.name
    // Remember the category of the specific product the user picked (e.g. "Hot & Cold
    // Drinks" for a sparkling water) so the backend can prefer matches in that same
    // category at every store, instead of always falling back to a fixed category
    // ranking that assumes generic words like "peach" mean fresh produce.
    newItems[index].category = product.category || null
    newItems[index].confirmed = true
    setItems(newItems)
    setActiveSuggestionIndex(null)
  }

  useEffect(() => {
    // FR-S1: a ?list=<id> link takes priority over local session state — that list
    // is loaded by the effect below instead.
    if (new URLSearchParams(window.location.search).get('list')) return

    const savedItems = sessionStorage.getItem('groceryItems')
    if (savedItems) {
      const parsed = JSON.parse(savedItems)
      parsed.forEach(item => {
        item.baseUnit = getBaseUnit(item.name)
        // Old sessions saved before these fields existed: fall back to sensible defaults.
        if (item.query === undefined) item.query = item.name
        if (item.category === undefined) item.category = null
        if (item.confirmed === undefined) item.confirmed = false
      })
      setItems(parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCatalog])

  useEffect(() => {
    // Local-session persistence keeps running regardless of shared-link state —
    // it coexists with, rather than gets replaced by, the shared-list sync below.
    sessionStorage.setItem('groceryItems', JSON.stringify(items))
  }, [items])

  // ========== FR-S1: load a shared list from ?list=<id>, if present ==========
  useEffect(() => {
    const listId = new URLSearchParams(window.location.search).get('list')
    if (!listId || listFetchAttempted.current) return
    listFetchAttempted.current = true

    setListLoading(true)
    setListLoadError('')

    const loadSharedList = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/lists/${listId}`)
        if (!res.ok) throw new Error('List not found')
        const data = await res.json()
        const loadedItems = (data.items || []).map(item => ({
          name: item.name ?? '',
          quantity: item.quantity ?? 1,
          baseUnit: getBaseUnit(item.name ?? ''),
          query: item.query ?? item.name ?? '',
          category: item.category ?? null,
          confirmed: item.confirmed ?? false
        }))
        if (loadedItems.length > 0) setItems(loadedItems)
        // Restore the sharer's supermarket selection + transport settings so the
        // plan is reproducible — but never their location, the viewer supplies that.
        if (data.selectedChains && data.selectedChains.length > 0) {
          setSelectedChains(data.selectedChains)
        }
        if (data.transportMode) setTransportMode(data.transportMode)
        if (data.fuelType) setFuelType(data.fuelType)
        if (data.walkingMaxKm !== undefined && data.walkingMaxKm !== null) {
          setWalkingMaxKm(data.walkingMaxKm)
        }
        skipNextSyncRef.current = true
        setSharedListId(listId)
        setListLoading(false)
      } catch (err) {
        console.error('Failed to load shared list:', err)
        // Per product decision: surface the error but stay in the loading state
        // rather than silently falling back to an editable blank list — the user
        // should notice something is wrong before they start typing into a list
        // that won't actually be shared.
        setListLoadError('This shared list link could not be loaded. It may have been removed, or there may be a connection issue. Try refreshing, or open the link again.')
      }
    }
    loadSharedList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ========== FR-S1: sync edits back to the shared list, debounced ==========
  useEffect(() => {
    if (!sharedListId) return
    if (skipNextSyncRef.current) {
      // This change came from a poll/load applying server data locally —
      // don't immediately PUT the same data straight back.
      skipNextSyncRef.current = false
      return
    }
    const timeoutId = setTimeout(() => {
      fetch(`${import.meta.env.VITE_API_BASE_URL}/api/lists/${sharedListId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, selectedChains, transportMode, fuelType, walkingMaxKm })
      }).catch(err => console.error('Failed to sync shared list:', err))
    }, 800)
    return () => clearTimeout(timeoutId)
  }, [items, selectedChains, transportMode, fuelType, walkingMaxKm, sharedListId])

  // ========== FR-S1: poll the shared list for other people's edits ==========
  // Keeps both the sharer's original tab and anyone else's tab reasonably in sync
  // while the page is open, without needing websockets for this prototype stage.
  useEffect(() => {
    if (!sharedListId) return
    const pollIntervalId = setInterval(async () => {
      // Skip this cycle if the user is actively typing — otherwise a poll landing
      // mid-keystroke would overwrite what they're typing with the last-synced
      // server version.
      if (activeEditRef.current) return
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/lists/${sharedListId}`)
        if (!res.ok) return // list may have been removed — don't hard-fail a background poll
        const data = await res.json()
        const polledItems = (data.items || []).map(item => ({
          name: item.name ?? '',
          quantity: item.quantity ?? 1,
          baseUnit: getBaseUnit(item.name ?? ''),
          query: item.query ?? item.name ?? '',
          category: item.category ?? null,
          confirmed: item.confirmed ?? false
        }))
        skipNextSyncRef.current = true
        setItems(polledItems)
        if (data.selectedChains) setSelectedChains(data.selectedChains)
        if (data.transportMode) setTransportMode(data.transportMode)
        if (data.fuelType) setFuelType(data.fuelType)
        if (data.walkingMaxKm !== undefined && data.walkingMaxKm !== null) {
          setWalkingMaxKm(data.walkingMaxKm)
        }
      } catch (err) {
        console.error('Failed to poll shared list:', err)
      }
    }, 5000)
    return () => clearInterval(pollIntervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedListId])

  // ========== FR-S1: create a new shareable link for the current list ==========
  const handleShareList = async () => {
    setShareLoading(true)
    setShareError('')
    setCopyStatus('')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, selectedChains, transportMode, fuelType, walkingMaxKm })
      })
      if (!res.ok) throw new Error('Failed to create shareable list')
      const data = await res.json()
      const link = `${window.location.origin}${window.location.pathname}?list=${data.id}`
      setShareLink(link)
      setSharedListId(data.id) // future edits now also sync to this new list
      // Move the address bar to the shared URL too, so refreshing this same tab
      // reloads (and keeps polling) the shared list instead of falling back to
      // local session state.
      window.history.replaceState(null, '', `${window.location.pathname}?list=${data.id}`)
      setShareModalOpen(true)
    } catch (err) {
      console.error('Failed to create share link:', err)
      setShareError('Could not create a share link. Please try again.')
    } finally {
      setShareLoading(false)
    }
  }

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopyStatus('copied')
    } catch (err) {
      console.error('Clipboard copy failed:', err)
      setCopyStatus('failed')
    }
  }

  // ========== FR07: generate shopping plans ==========
  const generatePlans = async () => {
    // first check if all required fields are filled in


    const itemsArray = items
        .filter(item => item.name.trim() !== '')
        // Send "query" — the loose search term — not "name" (which may be an
        // overly-specific matched product name from one particular chain's catalog).
        // Falls back to name for older saved items that don't have query yet.
        // Also send "category" (from the confirmed dropdown selection, if any) as a
        // hint so the backend restricts matching to that category at every store —
        // and "confirmedName", the exact specific product the user picked, so a store
        // that happens to carry that literal product can be matched to it directly.
        .map(item => ({
          name: (item.query ?? item.name).trim(),
          quantity: item.quantity,
          category: item.category || null,
          confirmedName: item.confirmed ? item.name.trim() : null
        }))

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
    setGloballyUnavailableItems([])

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

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Unknown error')
      }

      const data = await response.json()

      // backend returns { plans, message, globallyUnavailableItems }
      if (data.message) {
        setError(data.message)
        setPlans([])
      } else {
        setPlans(data.plans || data) // fallback for old format
        // FR05: items that had no price data at ANY selected store, across all plans
        setGloballyUnavailableItems(data.globallyUnavailableItems || [])
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
  // Presentation helpers
  // ================================================================
  const getPlanDistance = (plan) => {
    if (plan.transportMode === 'walking') {
      return plan.roundTripWalkingKm || plan.walkingDistance || 0
    }
    return plan.routeDistance || 0
  }

  const getOrderedStores = (plan) => {
    if (plan.transportMode !== 'walking' && plan.route && plan.route.length > 0) {
      return plan.route
          .map(branchId => plan.stores.find(store => store.branchId === branchId))
          .filter(Boolean)
    }
    return plan.stores || []
  }

  const renderPlanOverview = (plan) => {
    const orderedStores = getOrderedStores(plan)

    return (
        <div className="plan-overview">
          <div>
            <h4 className="overview-title">Stores to visit</h4>
            <ol className="store-list">
              {plan.stores.map((store, idx) => (
                  <li className="store-item" key={store.branchId}>
                    <span className="store-number">{idx + 1}</span>
                    <div>
                      <div className="store-name">
                        {getChainName(store.chainId)} · {store.branchName}
                      </div>
                      <div className="store-meta">
                        {store.address}
                        {plan.transportMode === 'walking'
                            ? ` · ${store.walkingTimeMin ? `~${store.walkingTimeMin} min walk` : `${store.distance.toFixed(1)} km`}`
                            : ` · ${(store.branchDistance || store.distance || 0).toFixed(1)} km away`
                        }
                      </div>
                      {store.items && store.items.length > 0 && (
                          <div className="store-meta">
                            {store.items.map(item => item.name).join(', ')}
                          </div>
                      )}
                    </div>
                  </li>
              ))}
            </ol>
          </div>

          <div>
            <h4 className="overview-title">Route overview</h4>
            <ol className="route-list">
              <li className="route-step"><strong>Home</strong></li>
              {orderedStores.map(store => (
                  <li className="route-step" key={store.branchId}>
                    <strong>{store.branchName}</strong>
                  </li>
              ))}
              <li className="route-step"><strong>Home</strong></li>
            </ol>
          </div>
        </div>
    )
  }

  const renderItemBreakdown = (plan) => {
    if (!plan.breakdown || plan.breakdown.length === 0) return null

    return (
        <details className="plan-details">
          <summary>View item breakdown</summary>
          <div className="table-scroll">
            <table className="item-table">
              <thead>
              <tr>
                <th className="align-center">Image</th>
                <th>Item</th>
                <th className="align-center">Qty</th>
                <th className="align-right">Unit price</th>
                <th className="align-right">Total</th>
                <th>Store</th>
              </tr>
              </thead>
              <tbody>
              {plan.breakdown.map((item, idx) => (
                  <tr key={idx}>
                    <td className="align-center">
                      {item.imageUrl ? (
                          <img
                              className="product-thumb"
                              src={item.imageUrl}
                              alt={item.matchedName || item.name}
                              onError={(e) => { e.target.style.display = 'none' }}
                          />
                      ) : null}
                    </td>
                    <td>
                      {item.name}
                      {item.matchedName && item.matchedName !== item.name && (
                          <div className="matched-name">
                            Matched: {item.matchedName}
                          </div>
                      )}
                    </td>
                    <td className="align-center">{item.quantity}</td>
                    <td className="align-right">${item.unitPrice.toFixed(2)}</td>
                    <td className="align-right">${item.total.toFixed(2)}</td>
                    <td>{getChainName(item.store)}</td>
                  </tr>
              ))}
              </tbody>
            </table>
          </div>
        </details>
    )
  }

  const renderPlanNotes = (plan) => (
      <Fragment>
        {plan.recommendedFuelStation && (
            <div className="inline-note">
              <strong>Recommended fuel stop:</strong> {plan.recommendedFuelStation.name}
              {plan.recommendedFuelStation.address ? ` · ${plan.recommendedFuelStation.address}` : ''}
              {` · $${plan.recommendedFuelStation.fuelPrice.toFixed(2)}/L · ${plan.recommendedFuelStation.distance.toFixed(1)} km away`}
            </div>
        )}
        {plan.missingItems && plan.missingItems.length > 0 && (
            <div className="inline-note warning">
              <strong>Not included:</strong> {plan.missingItems.join(', ')}
            </div>
        )}
      </Fragment>
  )

  const bestPlan = plans[0]
  const savings = plans.length > 1
      ? plans[plans.length - 1].trueCost - plans[0].trueCost
      : 0

  // ================================================================
  // RENDER
  // ================================================================
  return (
      <div className="app-shell">
        <header className="app-header">
          <div className="brand-lockup">
            <p className="eyebrow">Smarter grocery planning</p>
            <h1 className="app-title">Grocery Saver</h1>
            <p className="app-subtitle">
              Build your list, choose your stores, and find the most cost-effective trip.
            </p>
          </div>
          <button
              className="button button-secondary share-button"
              onClick={handleShareList}
              disabled={shareLoading}
          >
            {shareLoading ? 'Creating link…' : 'Share list'}
          </button>
        </header>

        {shareError && <div className="status-banner error">{shareError}</div>}
        {(listLoading || listLoadError) && (
            <div className={`status-banner${listLoadError ? ' error' : ''}`}>
              {listLoadError
                  ? listLoadError
                  : 'Loading the shared list and its saved shopping settings…'}
            </div>
        )}

        <main>
          <div className="planner-grid">
            <section className="panel grocery-panel">
              <div className="panel-header">
                <div>
                  <div className="step-label">
                    <span className="step-number">1</span>
                    Your list
                  </div>
                  <h2 className="panel-title">Grocery List</h2>
                  <p className="panel-description">Search for each product and set the quantity you need.</p>
                </div>
              </div>

              <div className="item-columns" aria-hidden="true">
                <span>Product</span>
                <span>Qty</span>
                <span>Unit</span>
                <span />
              </div>

              <div className="grocery-list">
                {items.map((item, index) => (
                    <div className="grocery-row" key={index}>
                      <div className="field-wrap">
                        <input
                            className="field"
                            type="text"
                            value={item.name}
                            onChange={(e) => {
                              updateItemName(index, e.target.value)
                              setActiveSuggestionIndex(e.target.value.trim() ? index : null)
                            }}
                            onFocus={(e) => {
                              activeEditRef.current = true
                              if (e.target.value.trim()) setActiveSuggestionIndex(index)
                            }}
                            onBlur={() => {
                              activeEditRef.current = false
                              setTimeout(() => setActiveSuggestionIndex(null), 150)
                            }}
                            placeholder="Search for a product"
                            aria-label={`Grocery item ${index + 1}`}
                        />

                        {activeSuggestionIndex === index && (() => {
                          const suggestions = getSuggestions(item.name)
                          if (suggestions.length === 0) return null

                          return (
                              <div className="suggestions">
                                {suggestions.map((product, productIndex) => (
                                    <div
                                        className="suggestion-item"
                                        key={productIndex}
                                        onMouseDown={() => selectSuggestion(index, product)}
                                    >
                                      {product.imageUrl ? (
                                          <img
                                              className="suggestion-image"
                                              src={product.imageUrl}
                                              alt=""
                                              onError={(e) => { e.target.style.visibility = 'hidden' }}
                                          />
                                      ) : (
                                          <span className="suggestion-placeholder">—</span>
                                      )}
                                      <div className="suggestion-copy">
                                        <div className="suggestion-name">{product.name}</div>
                                        <div className="suggestion-meta">
                                          {product.category}{product.baseUnit ? ` · ${product.baseUnit}` : ''}
                                        </div>
                                      </div>
                                    </div>
                                ))}
                              </div>
                          )
                        })()}
                      </div>

                      <input
                          className="field quantity-field"
                          type="number"
                          min="1"
                          value={item.quantity}
                          aria-label={`Quantity for grocery item ${index + 1}`}
                          onChange={(e) => {
                            const newItems = [...items]
                            const val = e.target.value
                            newItems[index].quantity = val === '' ? '' : parseInt(val) || item.quantity
                            setItems(newItems)
                          }}
                          onFocus={() => { activeEditRef.current = true }}
                          onBlur={(e) => {
                            activeEditRef.current = false
                            if (e.target.value === '' || parseInt(e.target.value) < 1) {
                              const newItems = [...items]
                              newItems[index].quantity = 1
                              setItems(newItems)
                            }
                          }}
                      />

                      <span className="unit-label">{item.baseUnit || '—'}</span>

                      <button
                          className="button button-danger-quiet"
                          onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}
                          aria-label={`Remove grocery item ${index + 1}`}
                          title="Remove item"
                      >
                        ×
                      </button>
                    </div>
                ))}
              </div>

              <button
                  className="button button-quiet add-item-button"
                  onClick={() => setItems([
                    ...items,
                    { name: '', quantity: 1, baseUnit: '', query: '', category: null, confirmed: false }
                  ])}
              >
                + Add item
              </button>
            </section>

            <div className="planner-sidebar">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="step-label">
                      <span className="step-number">2</span>
                      Store preferences
                    </div>
                    <h2 className="panel-title">Supermarkets</h2>
                    <p className="panel-description">Choose the chains you want included.</p>
                  </div>
                  <span className="selection-count">{selectedChains.length} selected</span>
                </div>

                {chains.length === 0 ? (
                    <p className="panel-description">Loading supermarkets…</p>
                ) : (
                    <div className="supermarket-list">
                      {chains.map(chain => (
                          <div className="supermarket-block" key={chain.chainId}>
                            <label className={`supermarket-option${selectedChains.includes(chain.chainId) ? ' selected' : ''}`}>
                              <input
                                  type="checkbox"
                                  checked={selectedChains.includes(chain.chainId)}
                                  onChange={() => handleChainToggle(chain.chainId)}
                              />
                              <span>{chain.name}</span>
                            </label>

                            {selectedChains.includes(chain.chainId) && branchesByChain[chain.chainId] && (
                                <details className="branch-details">
                                  <summary>
                                    {branchesByChain[chain.chainId].length} available branches
                                  </summary>
                                  <ul className="branch-list">
                                    {branchesByChain[chain.chainId].map(branch => (
                                        <li key={branch.branchId}>
                                          {branch.name}
                                          <span className="branch-address">{branch.address}</span>
                                        </li>
                                    ))}
                                  </ul>
                                </details>
                            )}
                          </div>
                      ))}
                    </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <div className="step-label">
                      <span className="step-number">3</span>
                      Your trip
                    </div>
                    <h2 className="panel-title">Trip Settings</h2>
                    <p className="panel-description">Set how you travel and where you start.</p>
                  </div>
                </div>

                <div className="segmented-control" aria-label="Transport mode">
                  <button
                      className={`segment-button${transportMode === 'driving' ? ' active' : ''}`}
                      onClick={() => setTransportMode('driving')}
                      aria-pressed={transportMode === 'driving'}
                  >
                    Driving
                  </button>
                  <button
                      className={`segment-button${transportMode === 'walking' ? ' active' : ''}`}
                      onClick={() => setTransportMode('walking')}
                      aria-pressed={transportMode === 'walking'}
                  >
                    Walking / Transit
                  </button>
                </div>

                {transportMode === 'driving' ? (
                    <div className="settings-box">
                      <label className="field-label" htmlFor="fuel-type">Fuel type</label>
                      <select
                          className="select-field"
                          id="fuel-type"
                          value={fuelType}
                          onChange={(e) => setFuelType(e.target.value)}
                      >
                        <option value="91">91 Octane</option>
                        <option value="95">95 Octane</option>
                        <option value="diesel">Diesel</option>
                      </select>
                      <p className="field-help">Uses 10 km/L efficiency and finds a nearby fuel station.</p>
                    </div>
                ) : (
                    <div className="settings-box">
                      <label className="field-label" htmlFor="walking-distance">Maximum walking distance</label>
                      <div className="range-row">
                        <input
                            className="range-field"
                            id="walking-distance"
                            type="range"
                            min="0.5"
                            max="5.0"
                            step="0.5"
                            value={walkingMaxKm}
                            onChange={(e) => setWalkingMaxKm(parseFloat(e.target.value))}
                        />
                        <span className="range-value">{walkingMaxKm.toFixed(1)} km</span>
                      </div>
                      <p className="field-help">Approximately {Math.round(walkingMaxKm / 5 * 60)} minutes each way.</p>
                    </div>
                )}

                <div className="location-block">
                  <span className="field-label">Starting location</span>
                  <div className="location-actions">
                    <button className="button button-secondary" onClick={getUserLocation}>
                      Use my location
                    </button>
                  </div>
                  {locationStatus && <p className="location-status">{locationStatus}</p>}

                  <details className="manual-location" defaultOpen={!userLat && !userLng}>
                    <summary>Enter coordinates manually</summary>
                    <div className="coordinate-grid">
                      <div>
                        <label className="field-label" htmlFor="latitude">Latitude</label>
                        <input
                            className="field"
                            id="latitude"
                            type="text"
                            value={userLat}
                            onChange={(e) => setUserLat(e.target.value)}
                            placeholder="-41.2865"
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="longitude">Longitude</label>
                        <input
                            className="field"
                            id="longitude"
                            type="text"
                            value={userLng}
                            onChange={(e) => setUserLng(e.target.value)}
                            placeholder="174.7762"
                        />
                      </div>
                    </div>
                    <p className="field-help">Wellington city centre: -41.2865, 174.7762</p>
                  </details>
                </div>
              </section>
            </div>
          </div>

          <div className="generate-area">
            {error && <div className="form-error">{error}</div>}
            <button
                className="button button-primary generate-button"
                onClick={generatePlans}
                disabled={loading}
            >
              {loading
                  ? 'Generating plans…'
                  : transportMode === 'walking'
                      ? 'Find Walking Plans'
                      : 'Generate Shopping Plans'}
            </button>
          </div>

          {bestPlan && (
              <section className="results-section">
                <div className="results-heading-row">
                  <div>
                    <p className="eyebrow">Your results</p>
                    <h2 className="results-title">Shopping Plans</h2>
                    <p className="results-subtitle">
                      {plans.length > 1
                          ? 'The best option is highlighted first. Explore alternatives only when you need them.'
                          : 'Here is the available plan for your trip.'}
                    </p>
                  </div>
                  <ExportHandler plans={plans} />
                </div>

                {globallyUnavailableItems.length > 0 && (
                    <div className="warning-banner">
                      <strong>No price data:</strong> {globallyUnavailableItems.join(', ')}.
                      These items are not included in the plans below.
                    </div>
                )}

                <article className="recommended-card">
                  <div className="recommended-main">
                    <div>
                      <span className="recommended-badge">
                        {plans.length > 1 ? 'Recommended · Best plan' : 'Your plan'}
                      </span>
                      <h3 className="recommended-title">{getStrategyLabel(bestPlan)}</h3>
                      {plans.length > 1 && (
                          <p className="savings-copy">
                            Save ${savings.toFixed(2)} compared with the most expensive option.
                          </p>
                      )}
                    </div>
                    <div className="total-cost-block">
                      <span className="total-cost-label">Total cost</span>
                      <span className="total-cost">${bestPlan.trueCost.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="metric-grid">
                    <div className="metric">
                      <span className="metric-label">Groceries</span>
                      <span className="metric-value">${bestPlan.groceryTotal.toFixed(2)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">
                        {bestPlan.transportMode === 'walking' ? 'Walking time' : 'Fuel cost'}
                      </span>
                      <span className="metric-value">
                        {bestPlan.transportMode === 'walking'
                            ? `~${bestPlan.roundTripWalkingTimeMin || 0} min`
                            : `$${(bestPlan.fuelCost || 0).toFixed(2)}`}
                      </span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Distance</span>
                      <span className="metric-value">{getPlanDistance(bestPlan).toFixed(1)} km</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Stores</span>
                      <span className="metric-value">{bestPlan.storeCount || bestPlan.stores.length}</span>
                    </div>
                  </div>

                  {renderPlanOverview(bestPlan)}
                  {renderPlanNotes(bestPlan)}
                  {renderItemBreakdown(bestPlan)}
                </article>

                {plans.length > 1 && (
                    <section className="alternatives-section">
                      <h3 className="subsection-heading">Other options</h3>
                      <p className="subsection-copy">Review a compact summary, then open a plan only if you need more detail.</p>

                      <div className="alternative-list">
                        {plans.slice(1).map(plan => (
                            <article
                                className="alternative-card"
                                key={`${plan.strategy}-${plan.stores.map(store => store.chainId).join('-')}-${plan.rank}`}
                            >
                              <div className="alternative-summary">
                                <div>
                                  <div className="alternative-rank">{getRankIcon(plan.rank)} Option {plan.rank}</div>
                                  <h4 className="alternative-name">{getStrategyLabel(plan)}</h4>
                                  <div className="alternative-meta">
                                    <span>Groceries ${plan.groceryTotal.toFixed(2)}</span>
                                    {plan.transportMode === 'walking'
                                        ? <span>{getPlanDistance(plan).toFixed(1)} km walk</span>
                                        : <span>Fuel ${(plan.fuelCost || 0).toFixed(2)}</span>
                                    }
                                    <span>{getPlanDistance(plan).toFixed(1)} km</span>
                                    <span>{plan.storeCount || plan.stores.length} stores</span>
                                  </div>
                                </div>
                                <div className="alternative-price">${plan.trueCost.toFixed(2)}</div>
                              </div>

                              <details className="alternative-details">
                                <summary>View plan details</summary>
                                <div className="alternative-detail-body">
                                  {renderPlanOverview(plan)}
                                  {renderPlanNotes(plan)}
                                  {renderItemBreakdown(plan)}
                                </div>
                              </details>
                            </article>
                        ))}
                      </div>
                    </section>
                )}

                {plans.length > 1 && (
                    <details className="comparison-disclosure">
                      <summary>Compare all plans</summary>
                      <div className="comparison-content">
                        <SummaryStats plans={plans} />
                        <div className="charts-grid">
                          <TrueCostChart plans={plans} />
                          <CostBreakdownChart plans={plans} />
                          <WalkingDistanceChart plans={plans} />
                        </div>
                        <ComparisonDashboard plans={plans} getChainName={getChainName} />
                      </div>
                    </details>
                )}
              </section>
          )}
        </main>

        {shareModalOpen && (
            <div className="modal-backdrop" onClick={() => setShareModalOpen(false)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h3 className="modal-title">Share this list</h3>
                <p className="modal-copy">
                  Anyone with this link can view and edit the list. Store and transport
                  settings are included; each person enters their own location.
                </p>
                <input
                    className="field"
                    type="text"
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.target.select()}
                />
                <div className="modal-actions">
                  <button
                      className="button button-secondary"
                      onClick={() => setShareModalOpen(false)}
                  >
                    Close
                  </button>
                  <button className="button button-primary" onClick={handleCopyShareLink}>
                    {copyStatus === 'copied'
                        ? 'Copied'
                        : copyStatus === 'failed'
                            ? 'Copy failed — copy manually'
                            : 'Copy link'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  )
}

export default App
