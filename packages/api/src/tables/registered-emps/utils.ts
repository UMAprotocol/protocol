export type Data = {
  id: string;
  address: string;
  blockNumber?: number;
};
export function makeId(data: Pick<Data, "address">) {
  return data.address;
}
