export function makeId(data: Pick<Data, "timestamp">) {
  return data.timestamp.toString().padStart(24, "0");
}

export type Data = {
  id?: string;
  timestamp: number;
  price: string;
};
