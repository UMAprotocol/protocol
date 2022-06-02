import assert from "assert";
import { ethers } from "ethers";

import { loop } from "../../utils";
import { toWei } from "../../across/utils";
import { setActiveRequestByTransaction } from "../common/services/statemachines";
import { ContextType } from "../common/types/statemachine";
import { StateMachine as GenericStateMachine } from "../common/services/statemachine";
import { OptimisticOracle } from "../common/services/optimisticOracle";

import { Store, Emit, Read, Has, Write, Update } from "./store";
import type { state } from "./types";
import { InputRequest, User } from "./types/state";
import { defaultConfig } from "./utils";

class StateMachine extends GenericStateMachine<state.State, OptimisticOracle, state.OptimisticOracleEvent> {}

export class Client {
  private intervalStarted = false;
  constructor(public readonly store: Store, public readonly sm: StateMachine, public readonly poller: StateMachine) {}
  setUser(params: Partial<User>): string {
    const address = params.address && ethers.utils.getAddress(params.address);
    return this.sm.create(ContextType.setUser, { ...params, address });
  }
  clearUser(): string {
    return this.sm.create(ContextType.clearUser, undefined);
  }
  setActiveRequest(params: InputRequest): string {
    const requester = ethers.utils.getAddress(params.requester);
    // these are case and number senstive
    const ancillaryData = params.ancillaryData.toLowerCase();
    const identifier = params.identifier.toLowerCase();
    const chainId = Number(params.chainId);
    const timestamp = Number(params.timestamp);
    const result = this.sm.create(ContextType.setActiveRequest, {
      requester,
      ancillaryData,
      identifier,
      chainId,
      timestamp,
    });
    this.sm.create(ContextType.updateActiveRequest, undefined);
    return result;
  }
  setActiveRequestByTransaction(params: setActiveRequestByTransaction.Params): string {
    const result = this.sm.create(ContextType.setActiveRequestByTransaction, params);
    this.sm.create(ContextType.updateActiveRequest, undefined);
    return result;
  }
  approveCollateral(): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
    const request = this.store.read().request();
    const inputRequest = this.store.read().inputRequest();
    const user: Partial<User> = this.store.read().user();
    const oracleAddress = this.store.read().oracleAddress();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    assert(request.currency, "Request currency is unknown");
    return this.sm.create(
      ContextType.approve,
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
    assert(request.currency, "Request currency is unknown");
    return this.sm.create(
      ContextType.proposePrice,
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
    assert(request.currency, "Request currency is unknown");
    return this.sm.create(
      ContextType.disputePrice,
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
  settle(): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
    const inputRequest = this.store.read().inputRequest();
    const user = this.store.read().user();
    const request = this.store.read().request();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    assert(request.currency, "Request currency is unknown");
    return this.sm.create(
      ContextType.disputePrice,
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
    return this.sm.create(
      ContextType.switchOrAddChain,
      { chainId: inputRequest.chainId, provider: user.provider },
      user.address
    );
  }
  // runs statemachine step loop pretty fast by default.
  startInterval(delayMs = 1): void {
    assert(!this.intervalStarted, "Interval already started, try stopping first");
    this.intervalStarted = true;
    loop(async () => {
      assert(this.intervalStarted, "Interval Stopped");
      // it turns out since these 2 state machines share the same immer state, they need to be run serially and
      // cant be run concurrently or you get wierd state oscillations. For now keep them in the same timing loop.
      await this.sm.tick();
      await this.poller.tick();
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
  const store = new Store({
    emit,
    state: {},
    Read,
    Write,
    Has,
    Update,
  });
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

  // this client must only specific state machine handlers which are compatible with this particular oracle
  const handlers = [
    ContextType.setUser,
    ContextType.clearUser,
    ContextType.setActiveRequest,
    ContextType.approve,
    ContextType.proposePrice,
    ContextType.switchOrAddChain,
    ContextType.pollActiveRequest,
    ContextType.pollActiveUser,
    ContextType.fetchPastEvents,
    ContextType.pollNewEvents,
    ContextType.setActiveRequestByTransaction,
    ContextType.settle,
    ContextType.updateActiveRequest,
  ];

  // this first state machine is for user actions
  const sm = new StateMachine(store);
  // this one is system actions used for long running commands independent of the user
  const poller = new StateMachine(store);

  handlers.forEach(sm.registerHandler);
  handlers.forEach(poller.registerHandler);

  // start the request list checkers
  for (const [chainId, config] of Object.entries(fullConfig.chains)) {
    poller.create(
      ContextType.fetchPastEvents,
      { chainId: Number(chainId), startBlock: config.earliestBlockNumber, maxRange: config.maxEventRangeQuery },
      "poller"
    );
    // long running poller which only looks for new events
    poller.create(
      ContextType.pollNewEvents,
      { chainId: Number(chainId), pollRateSec: config.checkTxIntervalSec },
      "poller"
    );
  }
  // create active request poller for all chains. Should only have one of these
  poller.create(ContextType.pollActiveRequest, undefined, "poller");
  // polls user for balances/approvals on the current chain, in case it changes external to app
  poller.create(ContextType.pollActiveUser, undefined, "poller");

  return new Client(store, sm, poller);
}
