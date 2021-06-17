export type Data = {
  id?: string;
  address: string;
  timestamp?: number;
  tvl?: string;
  tvm?: string;
};
export function makeId(data: Pick<Data, "address">) {
  return data.address;
}
