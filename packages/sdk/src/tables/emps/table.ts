import { Data, makeId } from "./utils";
import BaseTable from "../base";
import type { Store } from "../../stores";
import { JsMap } from "../../stores";

export const Table = (type = "Emp", store: Store<string, Data> = JsMap()) => {
  const table = BaseTable<string, Data, Store<string, Data>>({ type, makeId }, store);

  async function addSponsors(id: string, sponsors: string[]) {
    const data = await table.get(id);
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
