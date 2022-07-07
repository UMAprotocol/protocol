import { BigNumberish, BigNumber, Signer, TransactionResponse, TransactionReceipt } from "../types/ethers";
import { RequestState, RequestKey, Request as RequestFromEvent } from "../../clients/optimisticOracle";

export { RequestState, RequestKey };

export interface OracleProps {
  defaultLiveness: BigNumber;
}

export type Request = RequestFromEvent & { chainId: number };
export type Requests = Request[];

export interface OracleInterface {
  // u se this to query on chain for request data given the key.
  fetchRequest: (props: RequestKey) => Promise<Request>;
  // return cached request info syncronously
  getRequest: (props: RequestKey) => Request;
  disputePrice: (signer: Signer, key: RequestKey) => Promise<TransactionResponse>;
  proposePrice: (signer: Signer, key: RequestKey, price: BigNumberish) => Promise<TransactionResponse>;
  settle: (signer: Signer, key: RequestKey) => Promise<TransactionResponse>;
  update: (startBlock: number, endBlock: number | "latest") => Promise<void>;
  updateFromTransactionReceipt: (receipt: TransactionReceipt) => void;
  getProps: () => Promise<OracleProps>;
  listRequests: () => Requests;
}
