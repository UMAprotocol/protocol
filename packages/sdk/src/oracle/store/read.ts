import assert from "assert";

import type { State, Chain, Inputs, Request } from "../types/state";
import type { Signer } from "../types/ethers";

// This is a typescript compatible way of pulling out values from the global state object, essentially
// forming a basic API. Most calls are parameterless, requiring first setting state which determines, the
// user/chain, etc of the query.

export default class Read {
  constructor(private state: State) {}
  chainId(): number {
    const chainId = this.state?.user?.chainId;
    assert(chainId, "ChainId is not set");
    return chainId;
  }
  chain(): Partial<Chain> {
    const chainId = this.chainId();
    const chain = this.state?.chains?.[chainId];
    assert(chain, "Chain not set");
    return chain;
  }
  userAddress(): string {
    const address = this.state?.user?.address;
    assert(address, "User address is not set");
    return address;
  }
  oracleAddress(): string {
    const chain = this.chain();
    const address = chain?.optimisticOracle?.address;
    assert(address, "Optimistic oracle address not set");
    return address;
  }
  signer(): Signer {
    const signer = this.state?.user?.signer;
    assert(signer, "Signer is not set");
    return signer;
  }
  inputRequest(): Inputs["request"] {
    const input = this.state?.inputs?.request;
    assert(input, "Input request is not set");
    return input;
  }
  request(): Request {
    const chain = this.chain();
    const input = this.inputRequest();
    const id = [input.requester, input.identifier, input.timestamp, input.ancillaryData].join("!");
    const request = chain?.optimisticOracle?.requests?.[id];
    assert(request, "Request has not been fetched");
    return request;
  }
}
