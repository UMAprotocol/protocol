// Returns the currency name if its name is listed in the params.
// Otherwise, returns null.
export function currencyAddressToName(params, address) {
  const currencyName = params.currencies[address];
  // This is just to force the output to null rather than undefined.
  return currencyName == null ? null : currencyName;
}
