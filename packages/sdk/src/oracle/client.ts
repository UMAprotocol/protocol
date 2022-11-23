import assert from "assert";
import { ethers } from "ethers";
import Store, { Emit } from "./store";
import type { state } from "./types";
import type { FallbackProvider } from "./types/ethers";
import { InputRequest, User } from "./types/state";
import { Update } from "./services/update";
import { SortedRequests } from "./services/sortedRequests";
import { StateMachine, setActiveRequestByTransaction } from "./services/statemachines";
import { loop } from "../utils";
import { toWei } from "../across/utils";
import { NewOracle } from "./types/interfaces";

export class Client {
  private intervalStarted = false;
  constructor(
    public readonly store: Store,
    public readonly update: Update,
    public readonly sm: StateMachine,
    public readonly poller: StateMachine
  ) {}
  setUser(params: Partial<User>): string {
    const address = params.address && ethers.utils.getAddress(params.address);
    return this.sm.types.setUser.create({ ...params, address });
  }
  clearUser(): string {
    return this.sm.types.clearUser.create(undefined);
  }
  setActiveRequest(params: InputRequest): string {
    const requester = ethers.utils.getAddress(params.requester);
    // these are case and number senstive
    const ancillaryData = params.ancillaryData.toLowerCase();
    const identifier = params.identifier.toLowerCase();
    const chainId = Number(params.chainId);
    const timestamp = Number(params.timestamp);
    const result = this.sm.types.setActiveRequest.create({ requester, ancillaryData, identifier, chainId, timestamp });
    this.sm.types.updateActiveRequest.create(undefined);
    return result;
  }
  setActiveRequestByTransaction(params: setActiveRequestByTransaction.Params): string {
    const result = this.sm.types.setActiveRequestByTransaction.create(params);
    this.sm.types.updateActiveRequest.create(undefined);
    return result;
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
    assert(request.currency, "Request currency is unknown");
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
    assert(request.currency, "Request currency is unknown");
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
    assert(request.currency, "Request currency is unknown");
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
  settle(): string {
    const { checkTxIntervalSec } = this.store.read().chainConfig();
    const inputRequest = this.store.read().inputRequest();
    const user = this.store.read().user();
    const request = this.store.read().request();
    assert(user.address, "requires a user account address");
    assert(user.signer, "requires a user signer");
    assert(user.chainId === inputRequest.chainId, "On wrong chain");
    assert(request.currency, "Request currency is unknown");
    return this.sm.types.settle.create(
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

function makeProvider(rpcUrls: string[]): FallbackProvider {
  const providers = rpcUrls.map((url) => {
    const provider = ethers.getDefaultProvider(url);
    // turn off all polling, we will poll manually
    provider.polling = false;
    return provider;
  });
  const provider = new ethers.providers.FallbackProvider(providers, 1);
  // turn off all polling, we will poll manually
  provider.polling = false;
  return provider;
}
export function factory(
  config: state.Config,
  emit: Emit,
  OptimisticOracle: NewOracle,
  sortedRequests: SortedRequests
): Client {
  const store = new Store(emit);
  store.write((write) => {
    write.config(config);
    // maintains queryable ordered list of requests across all chains
    write.sortedRequestsService(sortedRequests);
    for (const chain of Object.values(config.chains)) {
      const provider = makeProvider(chain.rpcUrls);
      write.chains(chain.chainId).optimisticOracle().address(chain.optimisticOracleAddress);
      write.services(chain.chainId).provider(provider);
      write.services(chain.chainId).multicall2(chain.multicall2Address);
      write
        .services(chain.chainId)
        .optimisticOracle(new OptimisticOracle(provider, chain.optimisticOracleAddress, chain.chainId));
    }
  });
  const update = new Update(store);

  // this first state machine is for user actions
  const sm = new StateMachine(store);
  // this one is system actions used for long running commands independent of the user
  const poller = new StateMachine(store);

  // start the request list checkers
  for (const [chainId, chainConfig] of Object.entries(config.chains)) {
    poller.types.fetchPastEvents.create(
      {
        chainId: Number(chainId),
        startBlock: chainConfig.earliestBlockNumber,
        maxRange: chainConfig.maxEventRangeQuery,
      },
      "poller"
    );
    // long running poller which only looks for new events
    poller.types.pollNewEvents.create(
      { chainId: Number(chainId), pollRateSec: chainConfig.checkTxIntervalSec },
      "poller"
    );
    // updates event based data on all requests
    if (!chainConfig.disableFetchEventBased)
      poller.types.fetchEventBased.create({ chainId: Number(chainId) }, "poller");
  }
  // create active request poller for all chains. Should only have one of these
  poller.types.pollActiveRequest.create(undefined, "poller");
  // polls user for balances/approvals on the current chain, in case it changes external to app
  poller.types.pollActiveUser.create(undefined, "poller");

  return new Client(store, update, sm, poller);
}
