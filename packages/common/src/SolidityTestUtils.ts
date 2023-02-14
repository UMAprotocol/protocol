import type Web3 from "web3";
import type HRE from "hardhat";
type HardhatNetwork = typeof HRE["network"];

// Attempts to execute a promise and returns false if no error is thrown,
// or an Array of the error messages
export async function didContractThrow<T>(promise: Promise<T>): Promise<boolean> {
  try {
    await promise;
  } catch (error) {
    return !!(error as Error).message.match(/[invalid opcode|out of gas|revert]/);
  }
  return false;
}

// Attempts to execute a promise and returns false if no error is thrown,
// or the error message does not match the expected revert message
export async function didContractRevertWith<T>(promise: Promise<T>, revertMessage: string): Promise<boolean> {
  try {
    await promise;
  } catch (error) {
    const expectedErrorMessage = `VM Exception while processing transaction: reverted with reason string '${revertMessage}'`;
    return (error as Error).message === expectedErrorMessage;
  }
  return false;
}

type Web3Provider =
  | InstanceType<typeof Web3.providers.HttpProvider>
  | InstanceType<typeof Web3.providers.WebsocketProvider>;
type Callback = Parameters<Web3Provider["send"]>[1];
type CallbackResult = Parameters<Callback>[1];
type CallbackError = Parameters<Callback>[0];

export async function advanceBlockAndSetTime(web3: Web3, time: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (!web3.currentProvider || typeof web3?.currentProvider === "string" || !web3.currentProvider.send) {
      reject(new Error("No web3 provider that allows send()"));
      return;
    }
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", params: [time], id: new Date().getTime() },
      (err: CallbackError, result: CallbackResult) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
}

export async function stopMining(web3: Web3): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (!web3.currentProvider || typeof web3?.currentProvider === "string" || !web3.currentProvider.send) {
      reject(new Error("No web3 provider that allows send()"));
      return;
    }

    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "miner_stop", params: [], id: new Date().getTime() },
      (err: CallbackError, result: CallbackResult) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
}

async function startMining(web3: Web3): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (!web3.currentProvider || typeof web3?.currentProvider === "string" || !web3.currentProvider.send) {
      reject(new Error("No web3 provider that allows send()"));
      return;
    }
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "miner_start", params: [], id: new Date().getTime() },
      (err: CallbackError, result: CallbackResult) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      }
    );
  });
}

export async function takeSnapshot(web3: Web3): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (!web3.currentProvider || typeof web3?.currentProvider === "string" || !web3.currentProvider.send) {
      reject(new Error("No web3 provider that allows send()"));
      return;
    }
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_snapshot", id: new Date().getTime(), params: [] },
      (err: CallbackError, snapshotId: CallbackResult) => {
        if (err) {
          return reject(err);
        }
        return resolve(snapshotId);
      }
    );
  });
}

export async function revertToSnapshot(web3: Web3, id: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    if (!web3.currentProvider || typeof web3?.currentProvider === "string" || !web3.currentProvider.send) {
      reject(new Error("No web3 provider that allows send()"));
      return;
    }
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_revert", params: [id], id: new Date().getTime() },
      (err: CallbackError, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
}

type Contract = InstanceType<InstanceType<typeof Web3>["eth"]["Contract"]>;
type Transaction = ReturnType<InstanceType<InstanceType<typeof Web3>["eth"]["Contract"]>["deploy"]>;

// This function will mine all transactions in `transactions` in the same block with block timestamp `time`.
// The return value is an array of receipts corresponding to the transactions.
// Each transaction in transactions should be a web3 transaction generated like:
// let transaction = truffleContract.contract.methods.myMethodName(arg1, arg2);
// or if already using a web3 contract object:
// let transaction = web3Contract.methods.myMethodName(arg1, arg2);
export async function mineTransactionsAtTime(
  web3: Web3,
  transactions: Transaction[],
  time: number,
  sender: string
): Promise<Contract[]> {
  await stopMining(web3);

  try {
    const receiptPromises = [];
    for (const transaction of transactions) {
      const result = transaction.send({ from: sender });

      // Awaits the transactionHash, which signifies the transaction was sent, but not necessarily mined.
      await new Promise<void>((resolve, reject) => {
        result.once("transactionHash", function () {
          resolve();
        });
        result.once("error", function (error) {
          reject(error);
        });
      });

      // result, itself, is a promise that will resolve to the receipt.
      receiptPromises.push(result);
    }

    await advanceBlockAndSetTime(web3, time);
    const receipts = await Promise.all(receiptPromises);
    return receipts;
  } finally {
    // We need to restart Ganache's mining no matter what, otherwise the caller would have to restart their Ganache instance.
    await startMining(web3);
  }
}

// Very similar to the function above, but uses a hardhat network to send hardhat node compatible RPC methods.
export async function mineTransactionsAtTimeHardhat(
  network: HardhatNetwork,
  transactions: Transaction[],
  time: number,
  sender: string
): Promise<Contract[]> {
  await network.provider.send("evm_setAutomine", [false]);

  try {
    const receiptPromises = [];
    for (const transaction of transactions) {
      const result = transaction.send({ from: sender });

      // Awaits the transactionHash, which signifies the transaction was sent, but not necessarily mined.
      await new Promise<void>((resolve, reject) => {
        result.once("transactionHash", function () {
          resolve();
        });
        result.once("error", function (error) {
          reject(error);
        });
      });

      // result, itself, is a promise that will resolve to the receipt.
      receiptPromises.push(result);
    }

    await network.provider.send("evm_mine", [time]);
    const receipts = await Promise.all(receiptPromises);
    return receipts;
  } finally {
    // Restart automine.
    await network.provider.send("evm_setAutomine", [true]);
  }
}
