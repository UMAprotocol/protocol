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
  try {
    iterativelyReplaceBigNumbers(logEntry);
  } catch (_) {
    return logEntry;
  }
  return logEntry;
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
export function botIdentifyFormatter(botIdentifier: string) {
  return function (logEntry: LogEntry) {
    if (botIdentifier) logEntry["bot-identifier"] = botIdentifier;
    return logEntry;
  };
}

// Traverse a potentially nested object and replace any element that is either a Ethers BigNumber or web3 BigNumber
// with the string version of it for easy logging. Note does pass by reference by modifying the original object.
const iterativelyReplaceBigNumbers = (obj: any) => {
  Object.keys(obj).forEach((key) => {
    if (BigNumber.isBigNumber(obj[key]) || web3.utils.isBN(obj[key])) obj[key] = obj[key].toString();
    else if (typeof obj[key] === "object" && obj[key] !== null) iterativelyReplaceBigNumbers(obj[key]);
  });
};
