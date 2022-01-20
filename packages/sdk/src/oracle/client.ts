import assert from "assert";
import { ethers } from "ethers";
import Store, { Emit } from "./store";
import type { state } from "./types";
import { InputRequest, User } from "./types/state";
import { Update } from "./services/update";
import { StateMachine } from "./services/statemachines/statemachine";
import { loop } from "../utils";
import { toWei } from "../across/utils";

export class Client {
  private intervalStarted = false;
  constructor(public readonly store: Store, public readonly update: Update, public readonly sm: StateMachine) {}
  setUser(params: Partial<User>): string {
    params.address &&
      assert(
        ethers.utils.getAddress(params.address) === params.address,
        "Must specify user address as checkum address"
      );
    return this.sm.types.setUser.create(params);
  }
  clearUser(): string {
    return this.sm.types.clearUser.create(undefined);
  }
  setActiveRequest(params: InputRequest): string {
    return this.sm.types.setActiveRequest.create(params);
  }
  approveCollateral(): string {
    const request = this.store.read().request();
    const inputRequest = this.store.read().inputRequest();
    const user = this.store.read().user();
    const oracleAddress = this.store.read().oracleAddress();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    return this.sm.types.approve.create(
      {
        currency: request.currency,
        account: user.address,
        chainId: inputRequest.chainId,
        signer: user.signer,
        spender: oracleAddress,
        amount: ethers.constants.MaxUint256.toString(),
        confirmations: 1,
      },
      user.address
    );
  }
  proposePrice(proposedPriceDecimals: string | number): string {
    const proposedPrice = toWei(proposedPriceDecimals);
    const inputRequest = this.store.read().inputRequest();
    const request = this.store.read().request();
    const user = this.store.read().user();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    return this.sm.types.proposePrice.create(
      {
        ...inputRequest,
        proposedPrice,
        signer: user.signer,
        account: user.address,
        currency: request.currency,
        confirmations: 1,
      },
      user.address
    );
  }
  disputePrice(): string {
    const inputRequest = this.store.read().inputRequest();
    const user = this.store.read().user();
    const request = this.store.read().request();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    return this.sm.types.disputePrice.create(
      {
        ...inputRequest,
        confirmations: 1,
        signer: user.signer,
        account: user.address,
        currency: request.currency,
      },
      user.address
    );
  }
  switchOrAddChain(): string {
    const inputRequest = this.store.read().inputRequest();
    const user = this.store.read().user();
    assert(user.provider, "requires user provider");
    assert(user.address, "requires user address");
    assert(inputRequest.chainId, "requires active request chainId");
    return this.sm.types.switchOrAddChain.create(
      { chainId: inputRequest.chainId, provider: user.provider },
      user.address
    );
  }
  // runs statemachine step loop pretty fast by default.
  startInterval(delayMs = 10): void {
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
  stopInterval(): void {
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
