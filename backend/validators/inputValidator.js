// Input Validator Middleware
// Ensures data integrity before business logic runs

function validateGroceryList(req, res, next) {
  const { items, stores } = req.body

  // Check items exists and is an array
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid items: must be a non-empty array' })
  }

  // Validate each item has a valid name and quantity
  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
      return res.status(400).json({ error: `Item at index ${i}: name is required` })
    }

    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1) {
      return res.status(400).json({ error: `Item "${item.name}": quantity must be a positive number` })
    }
  }

  // Check stores exists and is a non-empty array
  if (!stores || !Array.isArray(stores) || stores.length === 0) {
    return res.status(400).json({ error: 'Invalid stores: must be a non-empty array' })
  }

  // Clean the data and pass to next handler
  req.body.items = items.map(item => ({
    name: item.name.trim(),
    quantity: item.quantity
  }))

  next()
}

module.exports = { validateGroceryList }
