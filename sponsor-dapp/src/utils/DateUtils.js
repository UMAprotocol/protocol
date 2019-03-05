// addDays returns a new date with `numDays` incremented to `date`.
// https://stackoverflow.com/questions/563406/add-days-to-javascript-date/34017571
export function addDays(date, numDays) {
  const result = new Date(date);
  result.setDate(result.getDate() + numDays);
  return result;
}

// secondsSinceEpoch returns number of seconds since Unix epoch.
export function secondsSinceEpoch(date) {
  return Math.floor(date.getTime() / 1000);
}
