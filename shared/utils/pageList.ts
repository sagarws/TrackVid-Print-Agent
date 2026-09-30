/**
 * 0-based page indices → the 1-based page list lp (`-P`) and SumatraPDF
 * accept: [4, 5, 8] → "5-6,9". Duplicates and order do not matter.
 */
export const pageList = (pages: readonly number[]): string => {
  const sorted = [...new Set(pages)]
    .filter(p => Number.isInteger(p) && p >= 0)
    .sort((a, b) => a - b)
    .map(p => p + 1)
  const ranges: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    ranges.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`)
    i = j + 1
  }
  return ranges.join(',')
}
