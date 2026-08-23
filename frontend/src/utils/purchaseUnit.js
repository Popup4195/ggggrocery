const COUNT_UNITS = new Set(['ea', 'each', 'item', 'unit', 'piece', 'pc', 'pack'])

const normalizeUnit = (value) => String(value ?? '').trim().toLowerCase()

const hasExplicitPackageSpecification = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return false

  const measuredPack = /(?:^|[\s(/-])\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml)\b/i
  const multiPack = /\b\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml)\b/i
  const countedPack = /\b(?:\d+[\s-]*(?:pack|pk)|pack\s+of\s+\d+)\b/i

  return measuredPack.test(text) || multiPack.test(text) || countedPack.test(text)
}

const hasStructuredPackageSpecification = (product) => {
  const explicitPackageFields = [product?.packageSize, product?.packSize]
  if (explicitPackageFields.some(value => value != null && /\d/.test(String(value)))) {
    return true
  }

  return hasExplicitPackageSpecification(product?.size)
}

const hasStructuredCountUnit = (product) => (
  [product?.unit, product?.sellUnit, product?.priceUnit]
      .some(value => COUNT_UNITS.has(normalizeUnit(value)))
)

export const getPurchaseSelection = (product) => {
  const originalBaseUnit = product?.baseUnit ?? ''
  const alreadyUsesCountUnit = COUNT_UNITS.has(normalizeUnit(originalBaseUnit))

  if (alreadyUsesCountUnit) {
    return {
      baseUnit: originalBaseUnit,
      isFixedPackaged: true,
      useExactQuery: false
    }
  }

  const isFixedPackaged = (
    hasStructuredCountUnit(product)
    || hasStructuredPackageSpecification(product)
    || hasExplicitPackageSpecification(product?.name)
  )

  return {
    baseUnit: isFixedPackaged ? 'ea' : originalBaseUnit,
    isFixedPackaged,
    useExactQuery: isFixedPackaged
  }
}
