import { Data, makeId } from "./utils";
import JsMap, { Table as BaseTable } from "../base/";
import { Store } from "../../stores";

export const Table = (type = "Emp", store: Store<string, Data>) => {
  const table = JsMap<string, Data, Store<string, Data>>({ type, makeId }, store);

  async function addSponsors(id: string, sponsors: string[]) {
    const data = await (table as BaseTable).get(id);
    // keep sponsors unique
    const set = new Set([...(data.sponsors || []), ...sponsors]);
    return table.update(id, { sponsors: Array.from(set.values()) });
  }

  async function setCreatedTimestamp(id: string, timestamp: number) {
    return table.update(id, { createdTimestamp: timestamp });
  }

  return {
    ...table,
    addSponsors,
    setCreatedTimestamp,
  };
};
// want to export the type as the same name
export type Table = ReturnType<typeof Table>;
