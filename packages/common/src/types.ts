import type _Web3 from "web3";

import { runTransaction } from "./TransactionUtils";

export type BN = ReturnType<_Web3["utils"]["toBN"]>;

export type TransactionType = Parameters<typeof runTransaction>[0]["transaction"];
