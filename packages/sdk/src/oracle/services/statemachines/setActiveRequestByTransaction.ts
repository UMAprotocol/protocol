import assert from "assert";
import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { optimisticOracle } from "../../../clients";

// required exports for state machine
export type Params = { chainId: number; transactionHash: string; eventIndex?: number };
export type Memory = { error?: Error };
export function initMemory(): Memory {
  return {};
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory) {
      const { chainId, transactionHash, eventIndex = 0 } = params;

      // have to do all of this to fetch the identifier, ancData, requester and timestamp from the request
      const provider = store.read().provider(chainId);
      const receipt = await provider.getTransactionReceipt(transactionHash);
      const oracleAddress = store.read().oracleAddress(chainId);
      // filter out logs that originate from oracle contract
      const oracleLogs = receipt.logs.filter((log) => log.address.toLowerCase() === oracleAddress.toLowerCase());
      // decode logs using abi
      const decodedLogs = oracleLogs.map((log) => optimisticOracle.contractInterface.parseLog(log));

      // this is the event we care about, we index into the appropriate oracle event generated from this tx
      const log = decodedLogs[eventIndex];
      // we dont actually know the type of the log, so we need to do some validation before continuing
      assert(log, `Unable to find optimistic oracle event at ${transactionHash} eventIndex ${eventIndex}`);
      assert(log.args, `Unable to find optimistic oracle event args at ${transactionHash} eventIndex ${eventIndex}`);
      assert(
        log.args.timestamp,
        `Unable to find optimistic oracle event.timestamp at ${transactionHash} eventIndex ${eventIndex}`
      );
      assert(
        log.args.requester,
        `Unable to find optimistic oracle event.requester at ${transactionHash} eventIndex ${eventIndex}`
      );
      assert(
        log.args.ancillaryData,
        `Unable to find optimistic oracle event.ancillaryData at ${transactionHash} eventIndex ${eventIndex}`
      );
      assert(
        log.args.identifier,
        `Unable to find optimistic oracle event.identifier at ${transactionHash} eventIndex ${eventIndex}`
      );

      // we can parse out the necessary params to kick off fetching the state of the request
      const requestInput = {
        timestamp: log.args.timestamp,
        requester: log.args.requester,
        ancillaryData: log.args.ancillaryData,
        identifier: log.args.identifier,
        chainId,
      };

      store.write((write) => write.inputs().request(requestInput));

      try {
        // these could fail at any point if user isnt set, but thats ok, state machine will catch error, and use can inspect.
        // this will rerun when user is set.
        await update.oracle();
        // get current time of chain when switching request
        await update.currentTime();
        await update.request();
        await update.collateralProps();
        // order is important, these should be last because they depend on user being set
        await update.userCollateralBalance();
        await update.oracleAllowance();
      } catch (err) {
        // its ok to ignore these errors
        memory.error = (err as unknown) as Error;
      }
      return "done";
    },
  };
}
