import { RawStore } from "./rawStore";
import { interfaces } from "../types";
/**
 * OracleStore. Wraps the store with a specific state shape and passes the Write client through to end user.
 */
export default class Store<State, Oracle, Events> implements interfaces.Store<State, Oracle, Events> {
  private store: RawStore<State>;
  public readonly update: interfaces.Update;
  constructor(public readonly config: interfaces.StoreConfig<State, Oracle, Events>) {
    this.store = new RawStore<State>(config.emit, config.state);
    this.update = new config.Update(this);
  }
  /**
   * write - Function for updating state.
   *
   * @param {WriteCallback} cb - Sends a write client to the caller for safer and easier state mutations rather than the raw object.
   */
  write = (cb: interfaces.WriteCallback<State, Events>): void => {
    this.store.write((state) => cb(new this.config.Write(state), state));
  };
  writeAsync = async (cb: interfaces.WriteCallback<State, Events>): Promise<void> => {
    await this.store.writeAsync(async (state) => await cb(new this.config.Write(state), state));
  };
  /**
   * read - Function for reading from state. Returns a read client to the user.
   *
   * @returns {Read}
   */
  read = (): interfaces.Read<Oracle, Events> => {
    return new this.config.Read(this.store.read());
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
  /**
   * has. Checks for existence. Mirrors the read interface, but instead of reading values returns true or false.
   *
   * @returns {Has}
   */
  has = (): interfaces.Has => {
    return new this.config.Has(this.store.read());
  };
}
