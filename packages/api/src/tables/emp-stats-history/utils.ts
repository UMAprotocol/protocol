export type Data = {
  id?: number;
  address?: string;
  timestamp: number;
  tvl?: string;
  tvm?: string;
};
export function makeId(data: Pick<Data, "timestamp">) {
  return data.timestamp;
}
