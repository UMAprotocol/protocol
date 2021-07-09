export type Data = {
  id?: number;
  address: string;
  timestamp: number;
  value: string;
};
// this is a funny id, but allows us to maintain time series data for multiple addresses in the same table
export function makeId(data: Pick<Data, "timestamp" | "address">) {
  return [data.address, data.timestamp.toString().padStart(16, "0")].join("!");
}
// this creates an id which would represents above the maximum value an address + timestamp can represent
// useful for calculating the end id for a between(start,end) query
export function makeEndId(data: Pick<Data, "address">) {
  return [data.address, "~"].join("!");
}
