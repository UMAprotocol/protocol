export function makeId(data: Pick<Data, "address">) {
  return data.address;
}

export type Data = {
  id?: string;
  address: string;
  decimals?: number;
  name?: string;
  totalSupply?: string;
  symbol?: string;
};
