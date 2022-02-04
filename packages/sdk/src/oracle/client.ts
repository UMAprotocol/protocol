import assert from "assert";
import { ethers } from "ethers";
import Store, { Emit } from "./store";
import type { state } from "./types";
import { InputRequest, User } from "./types/state";
import { Update } from "./services/update";
import { StateMachine, setActiveRequestByTransaction } from "./services/statemachines";
import { loop } from "../utils";
import { toWei } from "../across/utils";
import { defaultConfig } from "./utils";

export class Client {
  private intervalStarted = false;
  constructor(public readonly store: Store, public readonly update: Update, public readonly sm: StateMachine) {}
  setUser(params: Partial<User>): string {
    const address = params.address && ethers.utils.getAddress(params.address);
    return this.sm.types.setUser.create({ ...params, address });
  }
  clearUser(): string {
    return this.sm.types.clearUser.create(undefined);
  }
  setActiveRequest(params: InputRequest): string {
    const requester = ethers.utils.getAddress(params.requester);
    return this.sm.types.setActiveRequest.create({ ...params, requester });
  }
  setActiveRequestByTransaction(params: setActiveRequestByTransaction.Params): string {
    return this.sm.types.setActiveRequestByTransaction.create(params);
  }
  approveCollateral(): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
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
        checkTxIntervalSec,
      },
      user.address
    );
  }
  proposePrice(proposedPriceDecimals: string | number): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
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
        checkTxIntervalSec,
      },
      user.address
    );
  }
  disputePrice(): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
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
        checkTxIntervalSec,
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
      console.error(err);
      this.intervalStarted = false;
      this.store.write((w) => w.error(err));
    });
  }
  stopInterval(): void {
    assert(!this.intervalStarted, "Interval already stopped");
    this.intervalStarted = false;
  }
}

export function factory(config: state.PartialConfig, emit: Emit): Client {
  const store = new Store(emit);
  const fullConfig = defaultConfig(config);
  store.write((write) => {
    write.config(fullConfig);
    // maintains queryable ordered list of requests across all chains
    write.sortedRequestsService();
    for (const chain of Object.values(fullConfig.chains)) {
      write.chains(chain.chainId).optimisticOracle().address(chain.optimisticOracleAddress);
      write.services(chain.chainId).provider(chain.rpcUrls);
      write.services(chain.chainId).multicall2(chain.multicall2Address);
      write.services(chain.chainId).optimisticOracle(chain.optimisticOracleAddress);
    }
  });
  const update = new Update(store);
  // we can create "threads" by introducing new state machine queues, the first one is user actions
  const sm = new StateMachine(store);
  // this one is system actions used for long running commands independent of the user
  const poller = new StateMachine(store);

  // start the request list checkers
  for (const [chainId, config] of Object.entries(fullConfig.chains)) {
    poller.types.fetchPastEvents.create({ chainId: Number(chainId), startBlock: config.earliestBlockNumber }, "poller");
    // long running poller which only looks for new events
    poller.types.pollNewEvents.create({ chainId: Number(chainId) }, "poller");
  }

  // create active request poller for all chains. Should only have one of these
  poller.types.pollActiveRequest.create(undefined, "poller");
  // polls user for balances/approvals on the current chain, in case it changes external to app
  poller.types.pollActiveUser.create(undefined, "poller");

  // poller statemachine runs on its own loop
  loop(async () => {
    return poller.tick();
  }, 10).catch((err) => {
    console.error("poller error", err);
    store.write((w) => w.error(err));
  });
  return new Client(store, update, sm);
}
