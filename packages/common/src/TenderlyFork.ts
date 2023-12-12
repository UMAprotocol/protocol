// Manages Tenderly forks.
// Requires environment variables TENDERLY_USER, TENDERLY_PROJECT and TENDERLY_ACCESS_KEY to be set, check:
// - https://docs.tenderly.co/other/platform-access/how-to-find-the-project-slug-username-and-organization-name
// - https://docs.tenderly.co/other/platform-access/how-to-generate-api-access-tokens

import { Options as RetryOptions } from "async-retry";
import { BigNumber, providers, utils } from "ethers";

import { axiosWithRetry, isRecordStringUnknown, processTenderlyEnv, TenderlyEnvironment } from "./";

const defaultRetryOptions: RetryOptions = { retries: 0 }; // By default, do not retry, but the caller can override this.

// Fork parameters passed by the caller when creating a new fork.
export interface TenderlyForkParams {
  chainId: number;
  blockNumber?: number;
  txIndex?: number;
  alias?: string; // Shown as Fork Name in Tenderly UI when provided.
  description?: string; // Shown as Fork Note in Tenderly UI when provided.
}

// Fork request body sent to Tenderly API when creating a new fork.  We only type request properties that we use.
interface TenderlyForkRequestBody {
  network_id: string;
  block_number?: number;
  transaction_index?: number;
  alias?: string;
  description?: string;
}

// Response body returned by Tenderly API when creating a new fork or getting an existing one. We only type response
// properties that we use.
interface TenderlyForkAPIResponse {
  simulation_fork: {
    id: string;
    description?: string;
    block_number: number;
    transaction_index: number;
    accounts: Record<string, string>;
    global_head?: string; // Available only if there were any interactions with the fork.
    rpc_url: string;
  };
  root_transaction?: { id: string }; // Available only when creating new fork.
}

// Fork properties returned to the caller when creating a new fork or getting an existing one.
export interface TenderlyForkResult {
  id: string;
  blockNumber: number;
  txIndex: number;
  accounts: { address: string; privateKey: string }[];
  rpcUrl: string;
  headId?: string;
}

// Validate fork parameters passed by the caller when creating a new fork.
const validateForkParams = (forkParams: TenderlyForkParams): void => {
  if (!Number.isInteger(forkParams.chainId) || forkParams.chainId <= 0)
    throw new Error(`Invalid chainId: ${forkParams.chainId}`);
  if (forkParams.blockNumber !== undefined && (!Number.isInteger(forkParams.blockNumber) || forkParams.blockNumber < 0))
    throw new Error(`Invalid blockNumber: ${forkParams.blockNumber}`);
  if (forkParams.blockNumber === undefined && forkParams.txIndex !== undefined)
    throw new Error(`txIndex cannot be specified without blockNumber`);
  if (forkParams.txIndex !== undefined && (!Number.isInteger(forkParams.txIndex) || forkParams.txIndex < 0))
    throw new Error(`Invalid txIndex: ${forkParams.txIndex}`);
};

// Translate fork parameters passed by the caller when creating a new fork into the request body sent to Tenderly API.
const createForkRequestBody = (forkParams: TenderlyForkParams): TenderlyForkRequestBody => {
  const body: TenderlyForkRequestBody = {
    network_id: forkParams.chainId.toString(),
  };

  if (forkParams.blockNumber !== undefined) body.block_number = forkParams.blockNumber;
  if (forkParams.txIndex !== undefined) body.transaction_index = forkParams.txIndex;
  if (forkParams.alias !== undefined) body.alias = forkParams.alias;
  if (forkParams.description !== undefined) body.description = forkParams.description;

  return body;
};

// Type guard function to check if the API response contains a valid Tenderly simulation fork.
function isTenderlySimulationFork(
  simulationFork: unknown
): simulationFork is TenderlyForkAPIResponse["simulation_fork"] {
  if (
    isRecordStringUnknown(simulationFork) &&
    typeof simulationFork.id === "string" &&
    ("description" in simulationFork ? typeof simulationFork.description === "string" : true) && // Optional property
    typeof simulationFork.block_number === "number" &&
    typeof simulationFork.transaction_index === "number" &&
    isRecordStringUnknown(simulationFork.accounts) &&
    Object.values(simulationFork.accounts).every((value) => typeof value === "string") &&
    typeof simulationFork.rpc_url === "string" &&
    ("global_head" in simulationFork ? typeof simulationFork.global_head === "string" : true) // Optional property
  ) {
    return true;
  }
  return false;
}

// Type guard function to check if the API response contains a valid array of Tenderly simulation forks.
function isTenderlySimulationForkArray(
  simulationForks: unknown
): simulationForks is TenderlyForkAPIResponse["simulation_fork"][] {
  return (
    Array.isArray(simulationForks) &&
    simulationForks.every((simulationFork) => isTenderlySimulationFork(simulationFork))
  );
}

// Type guard function to check if the API response conforms to the required TenderlyForkAPIResponse interface
function isTenderlyForkAPIResponse(response: unknown): response is TenderlyForkAPIResponse {
  if (
    isRecordStringUnknown(response) &&
    isTenderlySimulationFork(response.simulation_fork) &&
    ("root_transaction" in response
      ? isRecordStringUnknown(response.root_transaction) && typeof response.root_transaction.id === "string"
      : true) // Optional property
  ) {
    return true;
  }
  return false;
}

// Send Tenderly fork API request to create a new fork.
const getCreateForkResponse = async (
  forkParams: TenderlyForkParams,
  tenderlyEnv: TenderlyEnvironment,
  retryOptions: RetryOptions
): Promise<TenderlyForkAPIResponse> => {
  // Construct Tenderly fork API request.
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/fork`,
    method: "POST",
    data: createForkRequestBody(forkParams),
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  const response = await axiosWithRetry(requestConfig, retryOptions);

  // If the HTTP response was valid, we expect the response body should be a JSON object containing expected Tenderly
  // fork response properties.
  if (!isTenderlyForkAPIResponse(response.data)) {
    throw new Error(`Failed to parse Tenderly fork API response: ${JSON.stringify(response.data)}`);
  }

  return response.data;
};

// Send Tenderly fork API request to share or unshare a fork.
const postForkSharing = async (
  forkId: string,
  share: boolean,
  tenderlyEnv: TenderlyEnvironment,
  retryOptions: RetryOptions
): Promise<void> => {
  // Construct Tenderly fork API request.
  const cmd = share ? "share" : "unshare";
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/fork/${forkId}/${cmd}`,
    method: "POST",
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  await axiosWithRetry(requestConfig, retryOptions);
};

// Translate Tenderly fork API response into the fork properties returned to the caller.
const forkAPIResponseToResult = (forkResponse: TenderlyForkAPIResponse): TenderlyForkResult => {
  return {
    id: forkResponse.simulation_fork.id,
    blockNumber: forkResponse.simulation_fork.block_number,
    txIndex: forkResponse.simulation_fork.transaction_index,
    accounts: Object.entries(forkResponse.simulation_fork.accounts).map(([address, privateKey]) => ({
      address,
      privateKey,
    })),
    rpcUrl: forkResponse.simulation_fork.rpc_url,
    headId: forkResponse.simulation_fork.global_head || forkResponse.root_transaction?.id,
  };
};

/**
 * @notice Creates a new Tenderly fork based on the provided `TenderlyForkParams`.
 * @param {TenderlyForkParams} forkParams - The parameters to configure the new Tenderly fork.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<TenderlyForkResult>} A Promise that resolves to the details of the created Tenderly fork.
 */
export const createTenderlyFork = async (
  forkParams: TenderlyForkParams,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<TenderlyForkResult> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  // Will throw if fork parameters are invalid.
  validateForkParams(forkParams);

  // Will throw if Tenderly API request fails or returns unparsable response.
  const forkResponse = await getCreateForkResponse(forkParams, tenderlyEnv, retryOptions);

  return forkAPIResponseToResult(forkResponse);
};

/**
 * @notice Retrieves information about a Tenderly fork with the specified `forkId`.
 * @param {string} forkId - The unique identifier of the Tenderly fork to retrieve.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<TenderlyForkResult>} A Promise that resolves to the details of the Tenderly fork.
 */
export const getTenderlyFork = async (
  forkId: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<TenderlyForkResult> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  // Construct Tenderly fork API request.
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/fork/${forkId}`,
    method: "GET",
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  const response = await axiosWithRetry(requestConfig, retryOptions);

  // If the HTTP response was valid, we expect the response body should be a JSON object containing expected Tenderly fork
  // response properties.
  if (!isTenderlyForkAPIResponse(response.data)) {
    throw new Error(`Failed to parse Tenderly fork API response: ${JSON.stringify(response.data)}`);
  }

  return forkAPIResponseToResult(response.data);
};

/**
 * @notice Shares a Tenderly fork with the specified `forkId`.
 * @param {string} forkId - The unique identifier of the Tenderly fork to share.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<string>} A Promise that resolves to the URL of the shared Tenderly fork in the Tenderly dashboard.
 */
export const shareTenderlyFork = async (
  forkId: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<string> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  await postForkSharing(forkId, true, tenderlyEnv, retryOptions);

  // Return the Tenderly dashboard URL for the shared fork.
  return `https://dashboard.tenderly.co/shared/fork/${forkId}/transactions`;
};

/**
 * @notice Unshares a previously shared Tenderly fork with the specified `forkId`.
 * @param {string} forkId - The unique identifier of the Tenderly fork to unshare.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<void>} A Promise that resolves once the specified Tenderly fork is successfully unshared.
 */
export const unshareTenderlyFork = async (
  forkId: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<void> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  await postForkSharing(forkId, false, tenderlyEnv, retryOptions);
};

/**
 * @notice Deletes a Tenderly fork with the specified `forkId`.
 * @param {string} forkId - The unique identifier of the Tenderly fork to delete.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<void>} A Promise that resolves once the specified Tenderly fork is successfully deleted.
 */
export const deleteTenderlyFork = async (
  forkId: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<void> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  // Construct Tenderly fork API request.
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/fork/${forkId}`,
    method: "DELETE",
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  await axiosWithRetry(requestConfig, retryOptions);
};

/**
 * @notice Sets the balance of a specific Ethereum address in a Tenderly fork.
 * @param {string} forkId - The unique identifier of the Tenderly fork where the balance should be updated.
 * @param {string} address - The Ethereum address for which to set the balance.
 * @param {string} balance - The new balance in wei to assign to the address.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<string>} A Promise that resolves to the updated head ID of the Tenderly fork after setting the balance.
 */
export const setTenderlyBalance = async (
  forkId: string,
  address: string,
  balance: string, // Amount in wei.
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<string> => {
  // Get provider for the Tenderly fork.
  const tenderlyFork = await getTenderlyFork(forkId, retryOptions);
  const provider = new providers.StaticJsonRpcProvider(tenderlyFork.rpcUrl);

  // Validate address and balance.
  if (!utils.isAddress(address)) throw new Error(`Invalid address: ${address}`);
  if (!BigNumber.from(balance).gte(0)) throw new Error(`Invalid balance: ${balance}`);

  // Send RPC request to set balance.
  await provider.send("tenderly_setBalance", [[address], utils.hexValue(BigNumber.from(balance).toHexString())]);

  // Changing balance updated the fork head, so we need to get the updated fork.
  const updatedFork = await getTenderlyFork(forkId, retryOptions);
  if (updatedFork.headId === undefined) throw new Error(`Failed to get updated fork head ID`);
  return updatedFork.headId;
};

/**
 * @notice Finds a Tenderly fork by its description.
 * @param {string} description - The description to search for in the Tenderly forks.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<TenderlyForkResult | undefined>} A Promise that resolves to the details of the matching Tenderly
 * fork if found, or `undefined` if not found.
 * @dev This function is useful to find a fork that was created by a previous run, e.g. to avoid creating a new fork
 * if one already exists.
 */
export const findForkByDescription = async (
  description: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<TenderlyForkResult | undefined> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  // Construct Tenderly fork API request.
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/forks`,
    method: "GET",
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  const response = await axiosWithRetry(requestConfig, retryOptions);

  // If the HTTP response was valid, we expect the response body should be a JSON object containing expected Tenderly fork
  // response properties.
  if (!isRecordStringUnknown(response.data) || !isTenderlySimulationForkArray(response.data.simulation_forks)) {
    throw new Error(`Failed to parse Tenderly fork API response: ${JSON.stringify(response.data)}`);
  }

  // Find the fork with the matching description.
  const matchingFork = response.data.simulation_forks.find(
    (simulationFork) => simulationFork.description === description
  );

  // If we found a matching fork, return the translated result.
  if (matchingFork !== undefined) return forkAPIResponseToResult({ simulation_fork: matchingFork });

  // Otherwise, return undefined.
  return undefined;
};

/**
 * @notice Sets the description of a specific simulation within a Tenderly fork.
 * @param {string} forkId - The unique identifier of the Tenderly fork where the simulation is located.
 * @param {string} simulationId - The unique identifier of the simulation for which to set the description.
 * @param {string} description - The new description to assign to the simulation.
 * @param {RetryOptions} [retryOptions=defaultRetryOptions] - Optional retry options for HTTP requests.
 * @returns {Promise<void>} A Promise that resolves once the description of the simulation is successfully updated.
 * @dev This function is useful to set a description on a simulation transaction that was not created through simulation
 * API (e.g. a transaction that was sent directly to the Tenderly fork RPC).
 */
export const setForkSimulationDescription = async (
  forkId: string,
  simulationId: string,
  description: string,
  retryOptions: RetryOptions = defaultRetryOptions
): Promise<void> => {
  // Will throw if required environment variables are not set.
  const tenderlyEnv = processTenderlyEnv();

  // Construct Tenderly fork API request.
  const requestConfig = {
    url: `https://api.tenderly.co/api/v1/account/${tenderlyEnv.user}/project/${tenderlyEnv.project}/fork/${forkId}/transaction/${simulationId}`,
    method: "PUT",
    data: { description },
    headers: { "X-Access-Key": tenderlyEnv.apiKey },
  };

  // Send Tenderly fork API request (Axios will throw if the HTTP response is not valid).
  await axiosWithRetry(requestConfig, retryOptions);
};
