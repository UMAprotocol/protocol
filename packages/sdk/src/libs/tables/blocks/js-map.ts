import { Data, makeId } from "./utils";
import { JsMap } from "../generic";

// personally dont like to have this as a named export, but cannot export both function and type as default
export const Table = (type = "Block") => {
  const table = JsMap<number, Data>(type, makeId);

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
export type Table = ReturnType<typeof Table>;
