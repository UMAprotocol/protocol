import { multicall } from "./clients";
import { Contract } from "ethers";
import type { SignerOrProvider } from "..";
import { zip } from "lodash";

export type Call = {
  method: string;
  args?: any[];
};

export type Request = {
  contractInstance: Contract;
  call: Call;
};
export type EncodedResponse = string;
export type EncodedRequest = {
  target: string;
  callData: string;
};

interface CoreState {
  requests: Request[];
  multicallClient: multicall.Instance;
}

// Core multicall functionality, not meant for use outside this file
class Core implements CoreState {
  public requests: Request[];
  public multicallClient: multicall.Instance;
  constructor(state: CoreState) {
    // make a copy of this so we dont mutate the original
    this.requests = [...state.requests];
    this.multicallClient = state.multicallClient;
  }

  // encode requests to multicall contract
  private encodeRequest(request: Request) {
    const { contractInstance, call } = request;
    return {
      target: contractInstance.address,
      callData: contractInstance.interface.encodeFunctionData(call.method, call.args),
    };
  }

  // decode response from multicall contract
  private decodeResponse(request: Request, response: EncodedResponse) {
    const { contractInstance, call } = request;
    return contractInstance.interface.decodeFunctionResult(call.method, response);
  }

  public add(contractInstance: Contract, call: Call) {
    this.requests.push({ contractInstance, call });
  }
  public batch(contractInstance: Contract, calls: Call[]) {
    calls.forEach((call: Call) => {
      this.add(contractInstance, call);
    });
  }
  // these requests only read contract state
  public async read(_requests: Request[] = this.requests) {
    const encodedRequests = _requests.map((request) => this.encodeRequest(request));
    const { returnData } = await this.multicallClient.callStatic.aggregate(encodedRequests);
    const zipped = zip(_requests, returnData);
    return zipped.map(([request, response]) => {
      if (request && response) return this.decodeResponse(request, response);
      throw new Error("Unable to decode contract response");
    });
  }
}

// Multicall class that exposes public functions to the user and recursively chains itself.  Acts immutable
// if you store reference to the parent intsance. Children will contain mutated state.
export class Multicall {
  private state: CoreState;
  constructor(state: CoreState) {
    this.state = state;
  }
  // adds a new request to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public add(contractInstance: Contract, call: Call) {
    const core = new Core(this.state);
    core.add(contractInstance, call);
    return new Multicall(core);
  }
  // adds a list of requests to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public batch(contractInstance: Contract, calls: Call[]) {
    const core = new Core(this.state);
    core.batch(contractInstance, calls);
    return new Multicall(core);
  }
  // reads from the contract, returns the read results in order that requests were queued.
  public async read(requests?: Request[]) {
    const core = new Core(this.state);
    return core.read(requests);
  }
}

export default class Factory extends Multicall {
  constructor(address: string, provider: SignerOrProvider) {
    const multicallClient = multicall.connect(address, provider);
    super({ multicallClient, requests: [] });
  }
}
