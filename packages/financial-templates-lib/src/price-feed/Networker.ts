// This class makes networking calls on behalf of the caller. Note: this is separated out to allow this functionality
// to be mocked out in tests so no real network calls have to be made.

import fetch from "node-fetch";
import type { Logger } from "winston";

type NetworkerOptions = Parameters<typeof fetch>[1];

export abstract class NetworkerInterface {
  public abstract getJson(url: string, options?: NetworkerOptions): Promise<any>;
}

export class Networker extends NetworkerInterface {
  /**
   * @notice Constructs new Networker.
   * @param {Object} logger Winston module used to send logs.
   */
  constructor(private readonly logger: Logger) {
    super();
  }

  async getJson(url: string, options: NetworkerOptions): Promise<any> {
    const response = await fetch(url, options);
    const json = await response.json();
    if (!json) {
      // Throw if no error. Will result in a retry upstream.
      throw new Error(`Networker failed to get json response. Response: ${response}`);
    }
    return json;
  }
}
