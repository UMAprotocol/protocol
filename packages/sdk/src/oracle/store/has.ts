// return true only if value is not null or undefined
import { exists } from "../../utils";

// we only ignore this specific error type explicitly emitted from reader class, meaning value is undefined
import { ignoreExistenceError } from "../errors";
import type { State } from "../types/state";

import Read from "./read";

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
    return exists(ignoreExistenceError(this.read.inputRequest));
  };
  sortedRequestsService = (): boolean => {
    return exists(ignoreExistenceError(this.read.sortedRequestsService));
  };
  requestChainId = (): boolean => {
    return exists(ignoreExistenceError(this.read.requestChainId));
  };
  userAddress = (): boolean => {
    return exists(ignoreExistenceError(this.read.userAddress));
  };
  request = (): boolean => {
    return exists(ignoreExistenceError(this.read.request));
  };
  collateralProps = (): boolean => {
    return exists(ignoreExistenceError(this.read.collateralProps));
  };
  defaultLiveness = (): boolean => {
    return exists(ignoreExistenceError(this.read.defaultLiveness));
  };
  currentTime = (): boolean => {
    return exists(ignoreExistenceError(this.read.currentTime));
  };
}
