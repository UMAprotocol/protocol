import { SortedJsMap } from "../../stores";
import { RequestIndex, RequestIndexes } from "../types/state";

export class SortedRequests {
  private table = SortedJsMap<string, RequestIndex>();
  async set(key: string, value: RequestIndex): Promise<void> {
    await this.table.set(key, value);
  }
  async descending(): Promise<RequestIndexes> {
    // sadly you cannot control lodash sorting descending, so reverse is necessary
    return (await this.table.values()).reverse();
  }
  async ascending(): Promise<RequestIndexes> {
    return this.table.values();
  }
}
