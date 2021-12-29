import Axios, { AxiosInstance, AxiosRequestConfig } from "axios";

type ValidationError = {
  field: string;
  code: number;
  reason: string;
};

// reverse engineered type from api response
type Response = {
  statusText: string;
  status: string;
  data: {
    reason: string;
    validationErrors: ValidationError[];
  };
};

// 0x api client, maintains raw responses when possible, parses errors to be human readable.
export default class Client {
  private axios: AxiosInstance;
  constructor(baseURL = "https://api.0x.org") {
    this.axios = Axios.create({ baseURL });
  }
  // this api returns schema validation errors which are nice, but not readable in an error message
  private stringifyValidationErrors(validationErrors: ValidationError[] = []) {
    if (validationErrors.length == 0) return "";
    return validationErrors.map(({ reason }) => reason).join(", ");
  }
  // errors returned from this api are rich, this function stringifies the complex object so it can be returned as a message
  private stringifyErrorResponse(response: Response) {
    let errorMessage = `${response.statusText}(${response.status})`;
    const reason = response.data?.reason;
    const validationErrorString = this.stringifyValidationErrors(response.data?.validationErrors);
    errorMessage += `: ${reason}`;
    if (validationErrorString.length) {
      errorMessage += `: ${validationErrorString}`;
    }
    return errorMessage;
  }
  // general call function which does some common parsing
  private async call(config: AxiosRequestConfig) {
    try {
      const response = await this.axios(config);
      return response.data;
    } catch (err) {
      const axiosError = err as { response?: Response };
      if (!axiosError.response) throw err;
      throw new Error(this.stringifyErrorResponse(axiosError.response));
    }
  }
  // get a price quote: swap/v1/price?sellToken=WETH&buyToken=DAI&sellAmount=1000000000000000000
  // this call requires one of sellAmount or buyAmount, but not both or neither
  public price(params: { sellToken: string; buyToken: string; sellAmount?: string; buyAmount?: string }) {
    const config: AxiosRequestConfig = {
      method: "GET",
      url: "/swap/v1/price",
      params,
    };
    return this.call(config);
  }
}
