export type Data = {
  id?: string;
  address: string;
  timestamp?: number;
  value?: string;
};
export function makeId(data: Pick<Data, "address">) {
  return data.address;
}
