import Web3 from "web3";
import assert from "assert";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class TraderConfig {
  readonly financialContractAddress: string;

  constructor(env: ProcessEnv) {
    const { EMP_ADDRESS } = env;
    assert(EMP_ADDRESS, "EMP_ADDRESS required");
    this.financialContractAddress = Web3.utils.toChecksumAddress(EMP_ADDRESS);
  }
}
