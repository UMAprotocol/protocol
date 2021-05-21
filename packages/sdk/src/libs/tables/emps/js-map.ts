import type { Data } from ".";
import { JsMap } from "../generic";

export default (type = "Emp") => {
  function makeId(data: Data) {
    return data.address;
  }
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
