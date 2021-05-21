import type { Data } from ".";
import { JsMap } from "../generic";

export default (type:string="Block") => {
  function makeId(data: Data) {
    return data.number;
  }
  return JsMap<number, Data>(type, makeId);
};
