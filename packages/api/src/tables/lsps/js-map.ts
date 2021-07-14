import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";
const { JsMap } = uma.tables.generic;

export const Table = (type = "LSP") => {
  const table = JsMap<string, Data>(type, makeId);

  async function addSponsors(id: string, sponsors: string[]) {
    const data = await table.get(id);
    // keep sponsors unique
    const set = new Set([...(data.sponsors || []), ...sponsors]);
    return table.update(id, { sponsors: Array.from(set.values()) });
  }

  return {
    ...table,
    addSponsors,
  };
};
// want to export the type as the same name
export type Table = ReturnType<typeof Table>;
