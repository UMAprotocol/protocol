import type { Data } from ".";
import { JsMap as GenericJsMap } from "../generic";

// personally dont like to have this as a named export, but cannot export both function and type as default
export const JsMap = (type = "Block") => {
  function makeId(data: Data) {
    return data.number;
  }

  const table = GenericJsMap<number, Data>(type, makeId);

  // delete blocks older than timestamp
  async function prune(timestamp: number) {
    const blocks = await table.values();
    const deleted: Data[] = [];
    // normally would use a map or filter, but dont want to include bluebird as a dependency
    for (const block of blocks) {
      if (block.timestamp < timestamp) {
        await table.delete(block.id ?? block.number);
        deleted.push(block);
      }
    }
    return deleted;
  }

  return {
    ...table,
    prune,
  };
};
export type JsMap = ReturnType<typeof JsMap>;
