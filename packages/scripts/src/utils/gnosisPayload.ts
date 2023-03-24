export interface GnosisPayload {
  version: string;
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: string;
    createdFromOwnerAddress: string;
    checksum: string;
  };
  transactions: GnosisTransaction[];
}

export interface GnosisTransaction {
  to: string;
  value: string;
  contractMethod: { inputs: { internalType: string; name: string; type: string }[]; name: string; payable: boolean };
  contractInputsValues: { [key: string]: string };
}

export function baseSafePayload(
  chainId: number,
  name: string,
  description: string,
  createdFromSafeAddress: string
): GnosisPayload {
  return {
    version: "1.0",
    chainId: chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: "1.13.2",
      createdFromSafeAddress,
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: [],
  };
}

export function appendTxToSafePayload(
  payload: any,
  to: string,
  contractMethod: any,
  contractInputsValues: any
): GnosisPayload {
  payload.transactions.push({
    to,
    value: "0",
    data: null,
    contractMethod,
    contractInputsValues,
  });
  return payload;
}
