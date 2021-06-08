export function makeId(data: Data) {
  return data.timestamp.toString().padStart(24, "0");
}

export type Data = {
  id?: string;
  timestamp: number;
  price: string;
};
