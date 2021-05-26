import Base from "../base";
import Store from "../../stores/js-map";
import type { Block } from ".";

const BlocksTable = () => {
  function makeId(data: Block) {
    return data.number.toString();
  }
  const store = Store<string, Block>();
  const table = Base<string, Block>({ makeId, type: "Block" }, store);
  return table;
};
export default BlocksTable;
