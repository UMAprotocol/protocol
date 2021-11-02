import { multicall } from "./clients";
import { Contract } from "ethers";
import type { SignerOrProvider } from ".";
import zip from "lodash/zip";

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

export interface State<MulticallType> {
  requests: Request[];
  multicallClient: MulticallType;
}

// Multicall class that exposes public functions to the user and recursively chains itself.  Acts immutable
// if you store reference to the parent intsance. Children will contain mutated state.
export class Multicall<MulticallType extends multicall.Instance> implements State<multicall.Instance> {
  public requests: Request[];
  public multicallClient: MulticallType;
  constructor(state: State<MulticallType>) {
    // make a copy of this so we dont mutate the original
    this.requests = [...state.requests];
    this.multicallClient = state.multicallClient;
  }

  // internally add requests to queue. Only called by parent for chaining.
  protected push(contractInstance: Contract, call: Call) {
    this.requests.push({ contractInstance, call });
  }

  // encode requests to multicall contract
  protected encodeRequest(request: Request) {
    const { contractInstance, call } = request;
    return {
      target: contractInstance.address,
      callData: contractInstance.interface.encodeFunctionData(call.method, call.args),
    };
  }

  // decode response from multicall contract
  protected decodeResponse(request: Request, response: EncodedResponse) {
    const { contractInstance, call } = request;
    return contractInstance.interface.decodeFunctionResult(call.method, response);
  }

  // adds a new request to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public add(contractInstance: Contract, call: Call) {
    const child = new Multicall(this);
    child.push(contractInstance, call);
    return child;
  }

  // adds a list of requests to the queue, to be executed when read is called. Returns an instance of this class so you can chain.
  public batch(contractInstance: Contract, calls: Call[]) {
    const child = new Multicall(this);
    calls.forEach((call: Call) => {
      child.push(contractInstance, call);
    });
    return child;
  }
  // reads from the contract, returns the read results in order that requests were queued.
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

// Factory that alters construction of multicall to be more friendly for end user
export default class Factory extends Multicall<multicall.Instance> {
  constructor(address: string, provider: SignerOrProvider) {
    const multicallClient = multicall.connect(address, provider);
    super({ multicallClient, requests: [] });
  }
}
