import Base from "../base";
import { SortedStore, SortedJsMap, Store } from "../../stores";

export default function <I, D>(type: string, makeId: (d: D) => I) {
  const store = SortedJsMap<I, D>();
  return Base<I, D>({ type, makeId }, store);
}
