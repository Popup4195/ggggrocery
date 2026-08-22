import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import ComparisonDashboard from './components/ComparisonDashboard'
import ExportHandler from './components/ExportHandler'
import { TrueCostChart, CostBreakdownChart, WalkingDistanceChart } from './components/VisualizationHelper'
import SummaryStats from './components/SummaryStats'


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
    return match ? match.baseUnit : ''
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
    // The displayed name becomes the specific matched product for clarity/confirmation,
    // but "query" is intentionally left untouched — it still holds the loose term the user
    // typed (e.g. "peach"), which is what actually gets sent to the backend. Sending the
    // hyper-specific product name instead would only match that exact listing at the one
    // chain it came from, leaving every other store's plan with an empty breakdown.
    newItems[index].name = product.name
    newItems[index].baseUnit = product.baseUnit
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
  // RENDER
  // ================================================================
  return (
      <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto', minWidth: 0 }}>
        <h1 style={{ marginBottom: '24px', lineHeight: 1.4 }}>🛒 Grocery Saver — Smart Shopping Plans</h1>


        {/* ============================================================ */}
        {/* SECTION 1: Grocery List                                      */}
        {/* ============================================================ */}
        <section style={{ marginBottom: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}> Your Grocery List</h2>
            <button
                onClick={handleShareList}
                disabled={shareLoading}
                style={{ padding: '6px 16px', cursor: shareLoading ? 'wait' : 'pointer' }}
            >
              {shareLoading ? 'Creating link...' : '🔗 Share list'}
            </button>
          </div>
          {shareError && (
              <p style={{ color: '#c00', fontSize: '0.9em', marginTop: '8px' }}>{shareError}</p>
          )}
          {(listLoading || listLoadError) && (
              <div style={{
                marginTop: '10px', marginBottom: '10px', padding: '8px 12px',
                backgroundColor: listLoadError ? '#f8d7da' : '#e7f3ff',
                border: listLoadError ? '1px solid #f5c2c7' : '1px solid #b6e0fe',
                borderRadius: '6px', fontSize: '0.9em',
                color: listLoadError ? '#842029' : '#333'
              }}>
                {listLoadError ? `⚠️ ${listLoadError}` : 'Loading shared list... your supermarket and transport settings will be restored — just add your location and generate plans.'}
              </div>
          )}
          {items.map((item, index) => (
              <div key={index} style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px',
                flexWrap: 'wrap'
              }}>
                <div style={{ position: 'relative', flex: '1 1 140px', minWidth: 0 }}>
                  <input
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
                      // Delay closing on blur so a suggestion's onMouseDown fires first —
                      // otherwise onBlur closes the dropdown before the click registers.
                      onBlur={() => {
                        activeEditRef.current = false
                        setTimeout(() => setActiveSuggestionIndex(null), 150)
                      }}
                      placeholder="Item name"
                      style={{ width: '100%', padding: '5px', boxSizing: 'border-box' }}
                  />
                  {activeSuggestionIndex === index && (() => {
                    const suggestions = getSuggestions(item.name)
                    if (suggestions.length === 0) return null
                    return (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          zIndex: 20,
                          background: '#fff',
                          border: '1px solid #ccc',
                          borderRadius: '6px',
                          marginTop: '2px',
                          maxHeight: '320px',
                          overflowY: 'auto',
                          boxShadow: '0 4px 10px rgba(0,0,0,0.12)'
                        }}>
                          {suggestions.map((product, pIdx) => (
                              <div
                                  key={pIdx}
                                  // onMouseDown (not onClick) so this fires before the input's onBlur
                                  onMouseDown={() => selectSuggestion(index, product)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 8px',
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #f0f0f0'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                              >
                                {product.imageUrl ? (
                                    <img
                                        src={product.imageUrl}
                                        alt={product.name}
                                        style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
                                        onError={(e) => { e.target.style.visibility = 'hidden' }}
                                    />
                                ) : (
                                    <span style={{
                                      width: '32px', height: '32px', flexShrink: 0, borderRadius: '4px',
                                      background: '#eee', display: 'inline-flex', alignItems: 'center',
                                      justifyContent: 'center', color: '#aaa', fontSize: '0.7em'
                                    }}>—</span>
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: '0.9em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {product.name}
                                  </div>
                                  <div style={{ fontSize: '0.75em', color: '#999' }}>
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
                    type="number"
                    min="1"
                    value={item.quantity}
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
                    style={{ width: '60px', flexShrink:0 ,padding: '5px' }}
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
              onClick={() => setItems([...items, { name: '', quantity: 1, baseUnit: '', query: '', category: null, confirmed: false }])}
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

              {/* FR05: items that couldn't be found at ANY selected store, across all plans */}
              {globallyUnavailableItems && globallyUnavailableItems.length > 0 && (
                  <div style={{
                    marginBottom: '16px', padding: '10px 14px', backgroundColor: '#f8d7da',
                    border: '1px solid #f5c2c7', borderRadius: '6px', fontSize: '0.9em', color: '#842029'
                  }}>
                    ⚠️ No price data found for the following item(s) at any selected store, so they are not included in any plan below: <strong>{globallyUnavailableItems.join(', ')}</strong>
                  </div>
              )}

              {/* FR09: Export toolbar */}
              <ExportHandler plans={plans} />
              <SummaryStats plans={plans} />

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      flexWrap: 'wrap',gap:'9px'
                    }}>
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

                    {/* FR05: items missing at THIS specific store's plan (still had a price somewhere else, so plan exists, but not at this combination) */}
                    {plan.missingItems && plan.missingItems.length > 0 && (
                        <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: '#fff3cd', borderRadius: '6px', fontSize: '0.85em', color: '#856404', display: 'inline-block' }}>
                          ⚠️ Not included in this plan (no match found): {plan.missingItems.join(', ')}
                        </div>
                    )}

                    {/* Item breakdown table */}
                    {plan.breakdown && plan.breakdown.length > 0 && (
                        <div style={{ overflowX:'auto',marginTop: '12px' }}>
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: '0.9em', color: '#007bff' }}>
                              View item breakdown
                            </summary>
                            <table style={{ marginTop: '8px', width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                              <thead>
                              <tr style={{ backgroundColor: '#f8f9fa' }}>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>Image</th>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'left' }}>Item</th>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>Qty</th>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>Unit Price</th>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>Total</th>
                                <th style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'left' }}>Store</th>
                              </tr>
                              </thead>
                              <tbody>
                              {plan.breakdown.map((item, idx) => {
                                const matched = item.matchedName
                                const image = item.imageUrl
                                return (
                                    <tr key={idx}>
                                      <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>
                                        {image ? (
                                            <img
                                                src={image}
                                                alt={matched || item.name}
                                                style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px' }}
                                                onError={(e) => { e.target.style.display = 'none' }}
                                            />
                                        ) : null}
                                      </td>
                                      <td style={{ padding: '6px', border: '1px solid #ddd' }}>
                                        {item.name}
                                        {matched && matched !== item.name && (
                                            <div style={{ fontSize: '0.8em', color: '#888', marginTop: '2px' }}>
                                              matched: {matched} (cheapest match in category)
                                            </div>
                                        )}
                                      </td>
                                      <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'center' }}>{item.quantity}</td>
                                      <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>
                                        ${item.unitPrice.toFixed(2)}
                                      </td>
                                      <td style={{ padding: '6px', border: '1px solid #ddd', textAlign: 'right' }}>
                                        ${item.total.toFixed(2)}
                                      </td>
                                      <td style={{ padding: '6px', border: '1px solid #ddd' }}>{getChainName(item.store)}</td>
                                    </tr>
                                )
                              })}
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

        {/* ========== FR-S1: share link modal ========== */}
        {shareModalOpen && (
            <div
                style={{
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}
                onClick={() => setShareModalOpen(false)}
            >
              <div
                  style={{ background: '#fff', padding: '20px', borderRadius: '8px', maxWidth: '440px', width: '90%' }}
                  onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ marginTop: 0 }}>Share this list</h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                  Anyone with this link can view and edit this list — no account needed.
                  Your selected supermarkets and transport mode come with it too; they'll
                  just need to enter their own location and hit "Generate Shopping Plans".
                  Edits sync automatically every few seconds while the page is open.
                </p>
                <input
                    type="text"
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.target.select()}
                    style={{ width: '100%', padding: '8px', boxSizing: 'border-box', marginBottom: '12px' }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                      onClick={() => setShareModalOpen(false)}
                      style={{ padding: '6px 14px', cursor: 'pointer' }}
                  >
                    Close
                  </button>
                  <button
                      onClick={handleCopyShareLink}
                      style={{
                        padding: '6px 14px', cursor: 'pointer', border: 'none',
                        borderRadius: '4px', backgroundColor: '#007bff', color: '#fff'
                      }}
                  >
                    {copyStatus === 'copied' ? '✓ Copied!' : copyStatus === 'failed' ? 'Copy failed — select & copy manually' : 'Copy Link'}
                  </button>
                </div>
              </div>
            </div>
        )}

      </div>
  )
}

export default App
