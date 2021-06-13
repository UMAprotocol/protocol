export function makeId(data: Pick<Data, "number">) {
  return data.number;
}

export type Data = {
  id?: number;
  number: number;
  hash: string;
  // block time is in seconds
  timestamp: number;
};
