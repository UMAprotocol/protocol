export type Data = {
  id: number;
  value: string;
  timestamp: number;
};
export function makeId(data: Pick<Data, "id">) {
  return data.id;
}
