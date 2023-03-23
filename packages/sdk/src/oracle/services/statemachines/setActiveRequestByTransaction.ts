import assert from "assert";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";

// required exports for state machine
export type Params = { chainId: number; transactionHash: string; eventIndex?: number };
export type Memory = undefined;
export function initMemory(): Memory {
  return undefined;
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  return {
    async start(params: Params) {
      const { chainId, transactionHash, eventIndex = 0 } = params;

      // search all known requests first
      const filteredRequests = store
        .read()
        .descendingRequests()
        .filter((request) => {
          if (request.chainId.toString() !== chainId.toString()) return false;
          if (
            ![
              request?.requestTx?.toLowerCase(),
              request?.proposeTx?.toLowerCase(),
              request?.disputeTx?.toLowerCase(),
              request?.settleTx?.toLowerCase(),
            ].includes(transactionHash.toLowerCase())
          )
            return false;
          return [
            request?.requestLogIndex?.toString(),
            request?.proposeLogIndex?.toString(),
            request?.disputeLogIndex?.toString(),
            request?.settleLogIndex?.toString(),
          ].includes(eventIndex.toString());
        });

      // if we found a request from known requests, then set it as our selected request
      if (filteredRequests.length === 1) {
        const [found] = filteredRequests;
        // we can parse out the necessary params to kick off fetching the state of the request
        const requestInput = {
          timestamp: found.timestamp,
          requester: found.requester,
          ancillaryData: found.ancillaryData,
          identifier: found.identifier,
          chainId,
        };
        store.write((write) => write.inputs().request(requestInput));
        return "done";
      }

      // have to do all of this to fetch the identifier, ancData, requester and timestamp from the request
      const provider = store.read().provider(chainId);
      const receipt = await provider.getTransactionReceipt(transactionHash);
      assert(receipt, "Unable to find transaction receipt from hash: " + transactionHash);
      const oracle = store.read().oracleService(chainId);
      const oracleAddress = store.read().oracleAddress(chainId);
      // filter out logs that originate from oracle contract
      const oracleLogs = receipt.logs.filter((log) => log.address.toLowerCase() === oracleAddress.toLowerCase());
      // decode logs using abi
      const decodedLogs = oracleLogs.map((log) => oracle.parseLog(log));

      // this is the event we care about, we index into the appropriate oracle event generated from this tx
      // we want to keep backwards compatibility with previous links which were indexed by an array index and not logIndex
      const log =
        decodedLogs.find((log) => log?.logIndex?.toString() === eventIndex.toString()) ||
        decodedLogs[eventIndex] ||
        decodedLogs[0];
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
      return "done";
    },
  };
}
