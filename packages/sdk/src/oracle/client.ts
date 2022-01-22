import assert from "assert";
import Store, { Emit } from "./store";
import type { state } from "./types";
import { Inputs } from "./types/state";
import { Signer } from "./types/ethers";
import { Update } from "./services/update";
import { StateMachine } from "./services/statemachines/statemachine";
import { loop } from "../utils";

export class Client {
  private intervalStarted = false;
  constructor(public readonly store: Store, public readonly update: Update, public readonly sm: StateMachine) {}
  setUser(address: string, chainId: number, signer: Signer): string {
    return this.sm.types.setUser.create({ address, chainId, signer });
  }
  setActiveRequest(params: Inputs["request"]): string {
    return this.sm.types.setActiveRequest.create(params);
  }
  // runs statemachine step loop pretty fast by default.
  startInterval(delayMs = 10) {
    assert(!this.intervalStarted, "Interval already started, try stopping first");
    this.intervalStarted = true;
    loop(async () => {
      assert(this.intervalStarted, "Interval Stopped");
      await this.sm.tick();
    }, delayMs).catch((err) => {
      this.intervalStarted = false;
      this.store.write((w) => w.error(err));
    });
  }
  stopInterval() {
    assert(!this.intervalStarted, "Interval already stopped");
    this.intervalStarted = false;
  }
}

export function factory(config: state.Config, emit: Emit): Client {
  const store = new Store(emit);
  store.write((write) => {
    write.config(config);
    for (const chain of Object.values(config.chains)) {
      write.chains(chain.chainId).optimisticOracle().address(chain.optimisticOracleAddress);
      write.services(chain.chainId).provider(chain.providerUrl);
      write.services(chain.chainId).multicall2(chain.multicall2Address);
      write.services(chain.chainId).optimisticOracle(chain.optimisticOracleAddress);
    }
  });
  const update = new Update(store);
  const sm = new StateMachine(store);
  return new Client(store, update, sm);
}
