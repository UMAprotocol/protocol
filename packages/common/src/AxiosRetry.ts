import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import retry, { Options as RetryOptions } from "async-retry";

// Axios wrapper that retries on network errors and non-2xx HTTP responses.
export const axiosWithRetry = async (
  requestConfig: AxiosRequestConfig,
  retryOptions: RetryOptions
): Promise<AxiosResponse> => {
  return await retry(async () => {
    return await axios(requestConfig);
  }, retryOptions);
};
