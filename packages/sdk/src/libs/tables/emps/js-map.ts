import type { Data } from ".";
import { JsMap as GenericJsMap } from "../generic";

export const JsMap = (type = "Emp") => {
  function makeId(data: Data) {
    return data.address;
  }
  const table = GenericJsMap<string, Data>(type, makeId);

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
export type JsMap = ReturnType<typeof JsMap>;
