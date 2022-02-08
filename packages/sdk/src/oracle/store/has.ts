import Read from "./read";
// we only ignore this specific error type explicitly emitted from reader class, meaning value is undefined
import { ignoreExistenceError as ignoreError } from "../errors";
import type { State } from "../types/state";

// This class checks for existence for values you could potentially read. It mirrors the read interface but returns bools from functions.
export default class Has {
  private read: Read;
  constructor(private state: State) {
    // by design, reads do not mutate or cause side effects
    this.read = new Read(state);
  }
  inputRequest = (): boolean => {
    // the rule about reads is they will only throw errors if it cant return the value you request.
    // If no errors are thrown the read was successful.
    // Reads will never not return a value without throwing an error, enforced by TS.
    return !!ignoreError(this.read.inputRequest);
  };
  sortedRequestsService = (): boolean => {
    return !!ignoreError(this.read.sortedRequestsService);
  };
}
