// Returns the currency name if its name is listed in the params.
// Otherwise, returns undefined.
export function currencyAddressToName(params, address) {
  return params.currencies[address];
}
