// Simulates transaction results on Tenderly.
// Requires environment variables TENDERLY_USER, TENDERLY_PROJECT and TENDERLY_ACCESS_KEY to be set, check:
// - https://docs.tenderly.co/other/platform-access/how-to-find-the-project-slug-username-and-organization-name
// - https://docs.tenderly.co/other/platform-access/how-to-generate-api-access-tokens

import { isAddress } from "@ethersproject/address";
import { BigNumber } from "@ethersproject/bignumber";
import { isHexString } from "@ethersproject/bytes";
import { AddressZero } from "@ethersproject/constants";
import retry, { Options as RetryOptions } from "async-retry";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

interface TenderlyEnvironment {
  user: string;
  project: string;
  apiKey: string;
}

interface ForkParams {
  id: string;
  root?: string; // If provided, simulation will be performed on top of this earlier simulation id.
}

// Simulation parameters passed by the caller.
export interface TenderlySimulationParams {
  chainId: number;
  to: string;
  input?: string;
  value?: string;
  from?: string; // If not provided, the zero address is used in the simulation.
  timestampOverride?: number;
  fork?: ForkParams;
}

interface ResultUrl {
  url: string; // This is the URL to the simulation result page (public or private).
  public: boolean; // This is false if the project is not publicly accessible.
}

// Simulation properties returned to the caller.
export interface TenderlySimulationResult {
  id: string;
  status: boolean; // True if the simulation succeeded, false if it reverted.
  resultUrl: ResultUrl;
}

// We only type Tenderly simulation API request properties that we use.
interface TenderlyRequestBody {
  save: boolean;
  save_if_fails: boolean;
  simulation_type: "quick" | "abi" | "full";
  network_id: string;
  from: string;
  to: string;
  input?: string;
  value?: string;
  root?: string;
  block_header?: {
    timestamp: string;
  };
}

// We only type Tenderly simulation API response properties that we use.
interface TenderlyAPIResponse {
  simulation: {
    id: string;
    status: boolean;
  };
}

const processEnvironment = (): TenderlyEnvironment => {
  dotenv.config();

  if (!process.env.TENDERLY_USER) throw new Error("TENDERLY_USER not set");
  if (!process.env.TENDERLY_PROJECT) throw new Error("TENDERLY_PROJECT not set");
  if (!process.env.TENDERLY_ACCESS_KEY) throw new Error("TENDERLY_ACCESS_KEY not set");

  return {
    user: process.env.TENDERLY_USER,
    project: process.env.TENDERLY_PROJECT,
    apiKey: process.env.TENDERLY_ACCESS_KEY,
  };
};

const validateSimulationParams = (simulationParams: TenderlySimulationParams): void => {
  if (!isAddress(simulationParams.to)) throw new Error(`Invalid to address: ${simulationParams.to}`);
  if (simulationParams.from !== undefined && !isAddress(simulationParams.from))
    throw new Error(`Invalid from address: ${simulationParams.from}`);
  if (simulationParams.input !== undefined && !isHexString(simulationParams.input))
    throw new Error(`Invalid input: ${simulationParams.input}`);
  if (simulationParams.value !== undefined && !BigNumber.from(simulationParams.value).gte(0))
    throw new Error(`Invalid value: ${simulationParams.value}`);
  if (simulationParams.timestampOverride !== undefined && !BigNumber.from(simulationParams.timestampOverride).gte(0))
    throw new Error(`Invalid timestampOverride: ${simulationParams.timestampOverride}`);
};

const createRequestUrl = (tenderlyEnv: TenderlyEnvironment, fork?: ForkParams): string => {
  const baseUrl = `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/`;
  return fork === undefined ? baseUrl + "simulate" : baseUrl + "fork/" + fork.id + "/simulate";
};

const createRequestBody = (simulationParams: TenderlySimulationParams): TenderlyRequestBody => {
  const body: TenderlyRequestBody = {
    save: true,
    save_if_fails: true,
    simulation_type: "full",
    network_id: simulationParams.chainId.toString(),
    to: simulationParams.to,
    input: simulationParams.input,
    value: simulationParams.value,
    from: simulationParams.from || AddressZero,
    root: simulationParams.fork?.root,
  };

  if (simulationParams.timestampOverride !== undefined) {
    body.block_header = {
      timestamp: BigNumber.from(simulationParams.timestampOverride).toHexString(),
    };
  }

  return body;
};

// Type guard function to check if the API response conforms to the required TenderlyAPIResponse interface
function isTenderlyAPIResponse(response: any): response is TenderlyAPIResponse {
  if (
    response &&
    response.simulation &&
    typeof response.simulation.id === "string" &&
    typeof response.simulation.status === "boolean"
  ) {
    return true;
  }
  return false;
}

const getSimulationResponse = async (
  simulationParams: TenderlySimulationParams,
  tenderlyEnv: TenderlyEnvironment,
  retryOptions: RetryOptions
): Promise<TenderlyAPIResponse> => {
  // Construct Tenderly simulation API request.
  const url = createRequestUrl(tenderlyEnv, simulationParams.fork);
  const body = createRequestBody(simulationParams);
  const headers = { "X-Access-Key": tenderlyEnv.apiKey };

  // Send Tenderly simulation API request with retries.
  const response = await retry(async () => {
    const fetchResponse = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });
    if (!fetchResponse.ok) {
      throw new Error(`Simulation API returned HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
    }
    return fetchResponse;
  }, retryOptions);

  // If the HTTP response was OK, we expect the response body should be a JSON object containing expected Tenderly
  // simulation response properties.
  const apiResponse = await response.json();
  if (!isTenderlyAPIResponse(apiResponse)) {
    throw new Error(`Failed to parse Tenderly simulation API response: ${JSON.stringify(apiResponse)}`);
  }
  return apiResponse;
};

const isProjectPublic = async (tenderlyEnv: TenderlyEnvironment, retryOptions: RetryOptions): Promise<boolean> => {
  const url = `https://api.tenderly.co/api/v1/public/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}`;
  const headers = { "X-Access-Key": tenderlyEnv.apiKey };

  // Return true only if the project API responds OK and the project is public. On any error, return false.
  try {
    const response = await retry(async () => {
      const fetchResponse = await fetch(url, {
        method: "GET",
        headers: headers, // Private projects require authentication.
      });
      if (!fetchResponse.ok) {
        throw new Error(`Project API returned HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
      }
      return fetchResponse;
    }, retryOptions);
    const projectResponse = (await response.json()) as { project: { public: boolean } };
    return projectResponse.project.public;
  } catch {
    return false;
  }
};

const getResultUrl = async (
  simulationId: string,
  tenderlyEnv: TenderlyEnvironment,
  retryOptions: RetryOptions,
  fork?: ForkParams
): Promise<ResultUrl> => {
  const publicUrl = `https://dashboard.tenderly.co/public/${tenderlyEnv.user}/${tenderlyEnv.project}/${
    fork !== undefined ? "fork-simulation" : "simulator"
  }/${simulationId}`;
  const privateUrl = `https://dashboard.tenderly.co/${tenderlyEnv.user}/${tenderlyEnv.project}/${
    fork !== undefined ? "fork/" + fork.id + "/simulation" : "simulator"
  }/${simulationId}`;

  return (await isProjectPublic(tenderlyEnv, retryOptions))
    ? { url: publicUrl, public: true }
    : { url: privateUrl, public: false };
};

export const simulateTenderlyTx = async (
  simulationParams: TenderlySimulationParams,
  retryOptions: RetryOptions = { retries: 0 } // By default, do not retry, but the caller can override this.
): Promise<TenderlySimulationResult> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processEnvironment();

  // Will throw if simulation parameters are invalid.
  validateSimulationParams(simulationParams);

  // Will throw if Tenderly API request fails or returns unparsable response.
  const simulationResponse = await getSimulationResponse(simulationParams, tenderlyEnv, retryOptions);

  // Get the URL to the simulation result page. If project is not public, the URL will be private (requires login).
  const resultUrl = await getResultUrl(
    simulationResponse.simulation.id,
    tenderlyEnv,
    retryOptions,
    simulationParams.fork
  );

  return { id: simulationResponse.simulation.id, status: simulationResponse.simulation.status, resultUrl };
};
