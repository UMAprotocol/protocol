export function makeId(data: Data) {
  return data.number;
}

export type Data = {
  id?: number;
  number: number;
  hash: string;
  // block time is in seconds
  timestamp: number;
};
