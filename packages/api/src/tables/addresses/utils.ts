export type Data = {
  id?: string;
  address: string;
};
export function makeId(data: Pick<Data, "address">) {
  return data.address;
}
