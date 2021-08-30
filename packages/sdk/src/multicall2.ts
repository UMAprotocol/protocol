import { multicall2 } from "./clients";
import { Call, Multicall, Request, State } from "./multicall";
import { zip } from "lodash";
import { SignerOrProvider } from ".";
import { Contract } from "ethers";

class Multicall2 extends Multicall {
  constructor(state: State) {
    super(state);
  }

  // reads from the contract, returns the read and error results in order that requests were queued.
  public async readWithErrors(_requests: Request[] = this.requests) {
    const encodedRequests = _requests.map((request) => this.encodeRequest(request));
    const [, , returnData] = await (this.multicallClient as multicall2.Instance).callStatic.tryBlockAndAggregate(
      false,
      encodedRequests
    );
    const zipped = zip(_requests, returnData);
    return zipped.map(([request, response]) => {
      if (request && response) {
        return {
          success: response.success,
          result: response.success ? this.decodeResponse(request, response.returnData) : undefined,
        };
      }
      throw new Error("Unable to decode contract response");
    });
  }

  // adds a new request to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public add(contractInstance: Contract, call: Call) {
    const multicall = super.add(contractInstance, call);
    return new Multicall2({
      multicallClient: multicall.multicallClient,
      requests: multicall.requests,
    });
  }

  // adds a list of requests to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public batch(contractInstance: Contract, calls: Call[]) {
    const multicall = super.batch(contractInstance, calls);
    return new Multicall2({
      multicallClient: multicall.multicallClient,
      requests: multicall.requests,
    });
  }
}

// Factory that alters construction of multicall2 to be more friendly for end user
export default class Multicall2Factory extends Multicall2 {
  constructor(address: string, provider: SignerOrProvider) {
    const multicallClient = multicall2.connect(address, provider);
    super({ multicallClient, requests: [] });
  }
}
