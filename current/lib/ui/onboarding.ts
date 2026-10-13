export function getFirstValueStep(totalDeals: number, analyzedDeals: number, scoredDeals: number) {
  return totalDeals === 0 ? 0 : analyzedDeals === 0 ? 1 : scoredDeals === 0 ? 2 : 3;
}
