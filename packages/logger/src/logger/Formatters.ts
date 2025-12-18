import type { LogEntry } from "winston";
import { BigNumber } from "ethers";
import web3 from "web3";

// If the log entry contains an error then extract the stack trace as the error message.
export function errorStackTracerFormatter(logEntry: LogEntry) {
  if (logEntry.error) {
    logEntry.error = handleRecursiveErrorArray(logEntry.error);
  }
  return logEntry;
}

// Iterate over each element in the log and see if it is a big number. if it is, then try casting it to a string to
// make it more readable. If something goes wrong in parsing the object (it's too large or something else) then simply
// return the original log entry without modifying it.
export function bigNumberFormatter(logEntry: LogEntry) {
  type SymbolRecord = Record<string | symbol, any>;
  try {
    // Out is the original object if and only if one or more BigNumbers were replaced.
    const out = iterativelyReplaceBigNumbers(logEntry);

    // Because winston depends on some non-enumerable symbol properties, we explicitly copy those over, as they are not
    // handled in iterativelyReplaceBigNumbers. This only needs to happen if logEntry is being replaced.
    if (out !== logEntry)
      Object.getOwnPropertySymbols(logEntry).map((symbol) => (out[symbol] = (logEntry as SymbolRecord)[symbol]));
    return out as LogEntry;
  } catch (_) {
    return logEntry;
  }
}

// Handle case where `error` is an array of errors and we want to display all of the error stacks recursively.
// i.e. `error` is in the shape: [[Error, Error], [Error], [Error, Error]]
export function handleRecursiveErrorArray(error: Error | any[]): string | any[] {
  // If error is not an array, then just return error information for there is no need to recurse further.
  if (!Array.isArray(error)) return error.stack || error.message || error.toString() || "could not extract error info";
  // Recursively add all errors to an array and flatten the output.
  return error.map(handleRecursiveErrorArray).flat();
}

// This formatter checks if the `BOT_IDENTIFIER` env variable is present. If it is, the name is appended to the message.
export function botIdentifyFormatter(botIdentifier: string, runIdentifier: string) {
  return function (logEntry: LogEntry) {
    logEntry["bot-identifier"] = botIdentifier;
    logEntry["run-identifier"] = runIdentifier;
    return logEntry;
  };
}

// Traverse a potentially nested object and replace any element that is either a Ethers BigNumber or web3 BigNumber
// with the string version of it for easy logging.
const iterativelyReplaceBigNumbers = (obj: Record<string | symbol, any>) => {
  // This does a DFS, recursively calling this function to find the desired value for each key.
  // It doesn't modify the original object. Instead, it creates an array of keys and updated values.
  const replacements = Object.entries(obj).map(([key, value]): [string, any] => {
    if (BigNumber.isBigNumber(value) || web3.utils.isBN(value)) return [key, value.toString()];
    else if (typeof value === "object" && value !== null) return [key, iterativelyReplaceBigNumbers(value)];
    else return [key, value];
  });

  // This will catch any values that were changed by value _or_ by reference.
  // If no changes were detected, no copy is needed and it is fine to discard the copy and return the original object.
  const copyNeeded = replacements.some(([key, value]) => obj[key] !== value);

  // Only copy if something changed. Otherwise, return the original object.
  return copyNeeded ? Object.fromEntries(replacements) : obj;
};

// Some transports do not support markdown formatted links (e.g. <https://google.com|google.com>). This method removes
// the text anchor and leave plain URLs in the message.
export function removeAnchorTextFromLinks(msg: string): string {
  const anchorTextRegex = /<([^|]+)\|[^>]+>/g;
  // $1 is a backreference to the first capture group containing plain URL.
  return msg.replace(anchorTextRegex, "$1");
}
