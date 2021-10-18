export type Data = {
  id: number;
  lastBlockUpdate?: number;
};
export function makeId(data: Pick<Data, "id">) {
  return data.id;
}
