import type { Data } from ".";
import { JsMap as GenericJsMap } from "../generic";

// personally dont like to have this as a named export, but cannot export both function and type as default
export const JsMap = (type = "Block") => {
  function makeId(data: Data) {
    return data.number;
  }
  return GenericJsMap<number, Data>(type, makeId);
};
export type JsMap = ReturnType<typeof JsMap>;
