// Simulates transaction results on Tenderly.
// Requires environment variables TENDERLY_USER, TENDERLY_PROJECT and TENDERLY_ACCESS_KEY to be set, check:
// - https://docs.tenderly.co/other/platform-access/how-to-find-the-project-slug-username-and-organization-name
// - https://docs.tenderly.co/other/platform-access/how-to-generate-api-access-tokens

import { Options as RetryOptions } from "async-retry";
import { BigNumber, constants, utils } from "ethers";
import * as dotenv from "dotenv";

import { axiosWithRetry, isRecordStringUnknown } from "./";

const defaultRetryOptions: RetryOptions = { retries: 0 }; // By default, do not retry, but the caller can override this.

export interface TenderlyEnvironment {
  user: string;
  project: string;
  apiKey: string;
}

export interface StateOverride {
  address: string;
  slot: string;
  offset?: number; // When used, the caller is responsible to ensure multiple values within a slot don't conflict.
  value: string;
}

interface ForkParams {
  id: string;
  root?: string; // If provided, simulation will be performed on top of this earlier simulation id.
}

// Simulation parameters passed by the caller.
export interface TenderlySimulationParams {
  chainId: number;
  to?: string;
  input?: string;
  value?: string;
  from?: string; // If not provided, the zero address is used in the simulation.
  timestampOverride?: number;
  stateOverrides?: StateOverride[]; // When used, the caller is responsible to ensure no conflicts in array elements.
  fork?: ForkParams;
  description?: string;
}

interface ResultUrl {
  url: string; // This is the URL to the simulation result page (public or private).
  public: boolean; // This is false if the project is not publicly accessible.
}

// Simulation properties returned to the caller when creating a Tenderly simulation.
export interface TenderlySimulationResult {
  id: string;
  status: boolean; // True if the simulation succeeded, false if it reverted.
  gasUsed: number;
  resultUrl: ResultUrl;
}

type StateObjects = Record<string, { storage: Record<string, string> }>;

// Simulation request body sent to Tenderly simulation API. We only type API request properties that we use.
interface TenderlyRequestBody {
  save: boolean;
  save_if_fails: boolean;
  simulation_type: "quick" | "abi" | "full";
  network_id: string;
  from: string;
  to?: string;
  input?: string;
  value?: string;
  root?: string;
  block_header?: {
    timestamp: string;
  };
  state_objects?: StateObjects;
  description?: string;
}

// Response body returned by Tenderly API for regular simulations. We only type API response properties that we use.
interface TenderlyAPIResponseRegular {
  simulation: {
    id: string;
    status: boolean;
    gas_used: number;
  };
}

// Response body returned by Tenderly API for forked simulations. We only type API response properties that we use.
interface TenderlyAPIResponseFork {
  simulation: {
    id: string;
    fork_id: string;
    status: boolean;
    receipt: { gasUsed: string };
  };
}

// Possible response body returned by Tenderly simulation API. We only type API response properties that we use.
type TenderlyAPIResponse = TenderlyAPIResponseRegular | TenderlyAPIResponseFork;

/**
 * @notice Checks for required environment variables and returns a TenderlyEnvironment object.
 * @returns TenderlyEnvironment object containing Tenderly user, project and access key.
 */
export const processTenderlyEnv = (): TenderlyEnvironment => {
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

// Validate hex string value to be within set bytes limit.
const isValidHexStringValue = (hexString: string, bytesLimit = 32): boolean => {
  return utils.isHexString(hexString) && BigInt(hexString) >= 0n && BigInt(hexString) < 2n ** BigInt(bytesLimit * 8);
};

// Validate state override parameter values.
const validateStateOverride = (stateOverride: StateOverride): void => {
  if (!utils.isAddress(stateOverride.address))
    throw new Error(`Invalid state override address: ${stateOverride.address}`);
  if (!isValidHexStringValue(stateOverride.slot)) throw new Error(`Invalid state override slot: ${stateOverride.slot}`);
  const offset = stateOverride.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= 32)
    throw new Error(`Invalid state override offset: ${offset}`);
  if (!isValidHexStringValue(stateOverride.value, 32 - offset))
    throw new Error(`Invalid state override value: ${stateOverride.value}`);
};

// Validate simulation parameters passed by the caller.
const validateSimulationParams = (simulationParams: TenderlySimulationParams): void => {
  if (simulationParams.to !== undefined && !utils.isAddress(simulationParams.to))
    throw new Error(`Invalid to address: ${simulationParams.to}`);
  if (simulationParams.from !== undefined && !utils.isAddress(simulationParams.from))
    throw new Error(`Invalid from address: ${simulationParams.from}`);
  if (simulationParams.input !== undefined && !utils.isBytesLike(simulationParams.input))
    throw new Error(`Invalid input: ${simulationParams.input}`);
  if (simulationParams.value !== undefined && !BigNumber.from(simulationParams.value).gte(0))
    throw new Error(`Invalid value: ${simulationParams.value}`);
  if (simulationParams.timestampOverride !== undefined && !BigNumber.from(simulationParams.timestampOverride).gte(0))
    throw new Error(`Invalid timestampOverride: ${simulationParams.timestampOverride}`);
  if (simulationParams.stateOverrides !== undefined)
    simulationParams.stateOverrides.forEach((stateOverride) => validateStateOverride(stateOverride));
};

// Convert state override array parameters to raw state interface.
const createStateObjects = (stateOverrides: StateOverride[]): StateObjects => {
  const stateObjects: StateObjects = {};

  for (const stateOverride of stateOverrides) {
    const address = stateOverride.address.toLowerCase();
    const slot = utils.hexZeroPad(stateOverride.slot.toLowerCase(), 32);
    const originalSlotValue = stateObjects[address]?.storage[slot] ? BigInt(stateObjects[address].storage[slot]) : 0n;
    const offset = stateOverride.offset ?? 0;

    // The caller is responsible to ensure values don't conflict within the same slot, we just do bitwise OR here.
    const value = (BigInt(stateOverride.value) << BigInt(offset * 8)) | originalSlotValue; // Offset is in bytes.

    if (stateObjects[address] === undefined) stateObjects[address] = { storage: {} };
    stateObjects[address].storage[slot] = utils.hexZeroPad("0x" + value.toString(16), 32);
  }

  return stateObjects;
};

// Construct Tenderly simulation API request URL.
const createRequestUrl = (tenderlyEnv: TenderlyEnvironment, fork?: ForkParams): string => {
  const baseUrl = `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/`;
  return fork === undefined ? baseUrl + "simulate" : baseUrl + "fork/" + fork.id + "/simulate";
};

// Construct Tenderly simulation API request body.
const createRequestBody = (simulationParams: TenderlySimulationParams): TenderlyRequestBody => {
  const body: TenderlyRequestBody = {
    save: true,
    save_if_fails: true,
    simulation_type: "full",
    network_id: simulationParams.chainId.toString(),
    to: simulationParams.to,
    input: simulationParams.input,
    value: simulationParams.value,
    from: simulationParams.from || constants.AddressZero,
    root: simulationParams.fork?.root,
    description: simulationParams.description,
  };

  if (simulationParams.timestampOverride !== undefined) {
    body.block_header = {
      timestamp: BigNumber.from(simulationParams.timestampOverride).toHexString(),
    };
  }
  if (simulationParams.stateOverrides !== undefined) {
    body.state_objects = createStateObjects(simulationParams.stateOverrides);
  }

  return body;
};

// Type guard function to check if the API response conforms to the required TenderlyAPIResponseRegular interface
function isTenderlyAPIResponseRegular(response: unknown): response is TenderlyAPIResponseRegular {
  if (
    isRecordStringUnknown(response) &&
    isRecordStringUnknown(response.simulation) &&
    typeof response.simulation.id === "string" &&
    typeof response.simulation.status === "boolean" &&
    typeof response.simulation.gas_used === "number"
  ) {
    return true;
  }
  return false;
}

// Type guard function to check if the API response conforms to the required TenderlyAPIResponseFork interface
function isTenderlyAPIResponseFork(response: unknown): response is TenderlyAPIResponseFork {
  if (
    isRecordStringUnknown(response) &&
    isRecordStringUnknown(response.simulation) &&
    typeof response.simulation.id === "string" &&
    typeof response.simulation.fork_id === "string" &&
    typeof response.simulation.status === "boolean" &&
    isRecordStringUnknown(response.simulation.receipt) &&
    typeof response.simulation.receipt.gasUsed === "string"
  ) {
    return true;
  }
  return false;
}

// Type guard function to check if the API response conforms to the required TenderlyAPIResponse interface
function isTenderlyAPIResponse(response: unknown): response is TenderlyAPIResponse {
  return isTenderlyAPIResponseRegular(response) || isTenderlyAPIResponseFork(response);
}

// Send Tenderly simulation API request and return the response body.
const getSimulationResponse = async (
  simulationParams: TenderlySimulationParams,
  tenderlyEnv: TenderlyEnvironment,
  retryOptions: RetryOptions
): Promise<TenderlyAPIResponse> => {
  // Construct Tenderly simulation API request.
  const requestConfig = {
    url: createRequestUrl(tenderlyEnv, simulationParams.fork),
    method: "POST",
    data: createRequestBody(simulationParams),
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly simulation API request (Axios will throw if the HTTP response is not valid).
  const response = await axiosWithRetry(requestConfig, retryOptions);

  // If the HTTP response was valid, we expect the response body should be a JSON object containing expected Tenderly
  // simulation response properties.
  if (!isTenderlyAPIResponse(response.data)) {
    throw new Error(`Failed to parse Tenderly simulation API response: ${JSON.stringify(response.data)}`);
  }
  return response.data;
};

// Check if the Tenderly project is public.
const isProjectPublic = async (tenderlyEnv: TenderlyEnvironment, retryOptions: RetryOptions): Promise<boolean> => {
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/public/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}`,
    method: "GET",
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Return true only if the project API responds OK and the project is public. On any error, return false.
  try {
    const response = await axiosWithRetry(requestConfig, retryOptions);
    const projectResponse = response.data as {
      project: { public: boolean };
    };
    return projectResponse.project.public;
  } catch {
    return false;
  }
};

// Get the URL to the simulation result page. If project is not public, the URL will be private (requires login).
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

/**
 * @notice Simulates a transaction on Tenderly to obtain its result and gas consumption.
 * @param {TenderlySimulationParams} simulationParams - The parameters for the transaction simulation.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<TenderlySimulationResult>} A Promise that resolves with the result of the transaction simulation,
 * including its ID, status (success or failure), gas used, and the URL to the simulation result page.
 */
export const simulateTenderlyTx = async (
  simulationParams: TenderlySimulationParams,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<TenderlySimulationResult> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

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

  return {
    id: simulationResponse.simulation.id,
    status: simulationResponse.simulation.status,
    gasUsed: isTenderlyAPIResponseRegular(simulationResponse)
      ? simulationResponse.simulation.gas_used
      : parseInt(simulationResponse.simulation.receipt.gasUsed),
    resultUrl,
  };
};
