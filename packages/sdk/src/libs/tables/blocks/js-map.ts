import Base from "../base";
import Store from "../../stores/js-map";
import type { BlockType } from "./index.d";

const BlocksTable = () => {
  function makeId(data: BlockType) {
    return data.number.toString();
  }
  const store = Store<string, BlockType>();
  const table = Base<string, BlockType>({ makeId, type: "Block" }, store);
  return table;
};
export default BlocksTable;
