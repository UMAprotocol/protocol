import Base from "../base";
import { SortedJsMap } from "../../stores";

export default function <I, D>(type: string, makeId: (d: D) => I) {
  const store = SortedJsMap<I, D>();
  const table = Base<I, D>({ type, makeId }, store);

  return {
    ...store,
    ...table,
  };
}
