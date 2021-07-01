import { multicall } from "./clients";
import { Contract } from "ethers";
import type { SignerOrProvider } from "..";
import { zip } from "lodash";

export type Call = [string, any[]] | [string];

export type Request = {
  contractInstance: Contract;
  call: Call;
};
export type EncodedResponse = string;
export type EncodedRequest = {
  target: string;
  callData: string;
};
export default class Multicall {
  private multicallClient: multicall.Instance;
  private requests: Request[];

  constructor(address: string, provider: SignerOrProvider) {
    this.multicallClient = multicall.connect(address, provider);
    this.requests = [];
  }

  public add(contractInstance: Contract, ...call: Call) {
    this.requests.push({ contractInstance, call });
  }
  public batch(contractInstance: Contract, calls: Call[]) {
    calls.forEach((call: Call) => {
      this.add(contractInstance, ...call);
    });
  }
  private encodeRequest(request: Request) {
    const { contractInstance, call } = request;
    return {
      target: contractInstance.address,
      callData: contractInstance.interface.encodeFunctionData(call[0], call[1]),
    };
  }

  private decodeResponse(request: Request, response: EncodedResponse) {
    const { contractInstance, call } = request;
    return contractInstance.interface.decodeFunctionResult(call[0], response);
  }

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
