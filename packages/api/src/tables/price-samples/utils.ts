export type Data = {
  id?: string;
  address: string;
  timestamp: number;
  price: string;
};
export function makeId(data: Pick<Data, "address">) {
  return data.address;
}
