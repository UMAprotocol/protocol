import Axios, { AxiosInstance } from "axios";

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

// describes valid axios config, might be a way to get this from axios
type AxiosConfig = {
  method: string;
  url: string;
  params: { [key: string]: any };
};

// 0x api client, maintains raw responses when possible, parses errors to be human readable.
export default class Client {
  private axios: AxiosInstance;
  constructor(baseURL: string) {
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
  private async call(config: AxiosConfig) {
    try {
      const response = await this.axios(config);
      return response.data;
    } catch (err) {
      if (err.response == null) throw err;
      throw new Error(this.stringifyErrorResponse(err.response));
    }
  }
  // get a price quote: swap/v1/price?sellToken=WETH&buyToken=DAI&sellAmount=1000000000000000000
  // this call requires one of sellAmount or buyAmount, but not both or neither
  public price(params: { sellToken: string; buyToken: string; sellAmount?: string; buyAmount?: string }) {
    const config = {
      method: "GET",
      url: "/swap/v1/price",
      params,
    };
    return this.call(config);
  }
}
