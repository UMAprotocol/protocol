import produce from "immer";

import * as interfaces from "../types/interfaces";

export class RawStore<S> implements interfaces.RawStore<S> {
  /**
   * constructor.
   *
   * @param {Emit} emit - Change callback, passes you the current and previous state any time theres a state change.
   * @param {State} state - The full state type which conforms to the state object.
   */
  constructor(private emit: interfaces.Emit<S>, private state: S) {}
  /**
   * write. Allows caller to write to state. This wraps the state in "immer" which manages nested updates to state
   * through a proxy interface. When write is complete, an event is emitted with the current and previous state.
   *
   * @param {WriteCallback} cb
   */
  write(cb: interfaces.RawWriteCallback<S>): void {
    const prevState = this.state;

    // immer's produce method, takes an object, and passes a draft of that object to the callback. Any changes to the draft
    // will be returned as the new state at the end of the callback. Changes to this object are optimized to be used in state
    // for React or other front-end state managers.
    this.state = produce(this.state, cb);

    // Once state is changed, an event is emitted, this is how we get changes out of the client and also allow for change detection.
    this.emit(this.state, prevState);
  }
  // same as write
  async writeAsync(cb: interfaces.RawWriteCallback<S>): Promise<void> {
    const prevState = this.state;
    this.state = await produce(this.state, cb);
    this.emit(this.state, prevState);
  }
  read(): S {
    return this.state;
  }
}
