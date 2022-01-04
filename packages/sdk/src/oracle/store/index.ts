import Write from "./write";
import Store, { WriteCallback, Emit } from "./store";
import { State } from "../types/state";

export { Write, Store };

/**
 * OracleStore. Wraps the store with a specific state shape and passes the Write client through to end user.
 */
export default class OracleStore {
  private store: Store<State>;
  constructor(private emit: Emit<State>, private state: State = {}) {
    this.store = new Store(emit, state);
  }
  /**
   * write - Function for updating state.
   *
   * @param {WriteCallback} cb - Sends a write client to the caller for safer and easier state mutations rather than the raw object.
   */
  write(cb: WriteCallback<Write>) {
    this.store.write((state) => cb(new Write(state)));
  }
}
