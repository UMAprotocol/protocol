import Base from "../base";
import Store from "../../stores/js-map";

export default function <I, D>(type: string, makeId: (d: D) => I) {
  const store = Store<I, D>();
  const table = Base<I, D>({ type, makeId }, store);
  return table;
}
