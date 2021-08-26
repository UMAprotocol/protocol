import { NetworkerInterface } from "./Networker";

// A mock of the Networker to allow the user to check the inputs and set the outputs of network requests.
export class NetworkerMock extends NetworkerInterface {
  // Value that will hold the most recent input to getJson.
  public getJsonInputs: string[] = [];

  // Value that will be returned on the next call to getJson.
  // Users of this mock should set this value to force getJson to return the value.
  public getJsonReturns: any[] = [];

  // Mocked getJson function.
  public async getJson(url: string): Promise<any> {
    // Note: shift and unshift add and remove from the front of the array, so the elements are ordered such that the
    // first elements in the arrays are the first in/out.
    this.getJsonInputs.unshift(url);
    return this.getJsonReturns.shift();
  }
}
