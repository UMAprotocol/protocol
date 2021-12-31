import type { State } from "../types/state";
import Write from "./write";
import produce from "immer";

export type WriteCallback = (write: Write) => void;
export type Store = {
  write: (cb: WriteCallback) => void;
};

export function factory(emit: (state: State, prev: State) => void = () => ({}), state: State = {}): Store {
  return {
    write(cb: WriteCallback) {
      const prevState = state;
      state = produce(state, (draft: State) => cb(new Write(draft)));
      emit(state, prevState);
    },
  };
}
