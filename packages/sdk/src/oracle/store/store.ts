import produce from "immer";

export type WriteCallback<S> = (state: S) => void;
export type Emit<S> = (state: S, prev: S) => void;
/**
 * Store. The store is meant to provide a global state that conforms to the type in types/state and
 * allow you to read/write and watch for change events. This uses immer, which manages how the nested
 * object gets updated to allow shallow change detection through nested paths.
 */
export default class Store<S> {
  /**
   * constructor.
   *
   * @param {Emit} emit - Change callback, passes you the current and previous state any time theres a state change.
   * @param {State} state - The full state type which conforms to the state object.
   */
  constructor(private emit: Emit<S>, private state: S) {}
  /**
   * write. Allows caller to write to state. This wraps the state in "immer" which manages nested updates to state
   * through a proxy interface. When write is complete, an event is emitted with the current and previous state.
   *
   * @param {WriteCallback} cb
   */
  write(cb: WriteCallback<S>): void {
    const prevState = this.state;

    // immer's produce method, takes an object, and passes a draft of that object to the callback. Any changes to the draft
    // will be returned as the new state at the end of the callback. Changes to this object are optimized to be used in state
    // for React or other front-end state managers.
    this.state = produce(this.state, cb);

    // Once state is changed, an event is emitted, this is how we get changes out of the client and also allow for change detection.
    this.emit(this.state, prevState);
  }
  // same as write
  async writeAsync(cb: WriteCallback<S>): Promise<void> {
    const prevState = this.state;
    this.state = await produce(this.state, cb);
    this.emit(this.state, prevState);
  }
  read(): S {
    return this.state;
  }
}
