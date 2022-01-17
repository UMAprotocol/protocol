import Write from "./write";
import Read from "./read";

import Store, { WriteCallback as GenericWriteCallback, Emit as GenericEmit } from "./store";
import { State } from "../types/state";

type WriteCallback = GenericWriteCallback<Write>;
type Emit = GenericEmit<State>;

export { Write, Store, Read, Emit, WriteCallback };

/**
 * OracleStore. Wraps the store with a specific state shape and passes the Write client through to end user.
 */
export default class OracleStore {
  private store: Store<State>;
  constructor(private emit: Emit = () => undefined, private state: State = {}) {
    this.store = new Store<State>(emit, state);
  }
  /**
   * write - Function for updating state.
   *
   * @param {WriteCallback} cb - Sends a write client to the caller for safer and easier state mutations rather than the raw object.
   */
  write = (cb: WriteCallback): void => {
    this.store.write((state) => cb(new Write(state)));
  };
  /**
   * read - Function for reading from state. Returns a read client to the user.
   *
   * @returns {Read}
   */
  read = (): Read => {
    return new Read(this.store.read());
  };
  /**
   * get - Function for getting access to the raw state object, not wrapped by the reader class.
   * State should not be modified directly and treated as read only.
   *
   * @returns {State}
   */
  get = (): State => {
    return this.store.read();
  };
}
