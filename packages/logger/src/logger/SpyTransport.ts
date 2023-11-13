// This transport enables unit tests to validate values passed to Winston using a Sinon Spy.

import Transport from "winston-transport";
import minimist from "minimist";
import type sinon from "sinon";
const argv = minimist(process.argv.slice(), { boolean: ["logInTest"] });

type Spy = sinon.SinonSpy<any>;

type TransportOptions = ConstructorParameters<typeof Transport>[0];

export class SpyTransport extends Transport {
  private readonly spy: Spy;
  constructor(winstonOptions: TransportOptions, spyOptions: { spy: Spy }) {
    super(winstonOptions);
    this.spy = spyOptions.spy; // local instance of the spy to capture passed messages.
  }

  async log(info: any, callback: () => void): Promise<void> {
    // Add an `logInTest` option to help with debugging to bots in tests by printing all logs received by winston.
    if (argv._.includes("logInTest"))
      try {
        console.log(JSON.stringify(info, null, 2));
      } catch (error) {
        console.log("Formatting log failed. Log:", info);
      }
    // Add info sent to the winston transport to the spy. This enables unit tests to validate what is passed to winston.
    this.spy(info);
    callback();
  }
}

// Helper function used by unit tests to check if the last message sent to winston contains a particular string value.
// Caller feeds in the spy instance and the value to check.
export function lastSpyLogIncludes(spy: Spy, value: string): boolean {
  return spyLogIncludes(spy, -1, value);
}

export function spyLogIncludes(spy: Spy, messageIndex: number, value: string): boolean {
  // Sinon's getCall(n) function returns values sent in the nth (zero-indexed) call to the spy. Flatten the whole object
  // and any log messages included and check if the provided value is within the object.
  // Some calls embed a LOT of data within the errors, such as hardhat contract reverts which include the full solidity
  // source code. In this case the JSON.strigify will fail on the full message object. To accommodate this we can simplify
  // what we search for in the log message to simply the search space.
  try {
    const lastLogMessage = JSON.stringify([
      spy.getCall(messageIndex).lastArg,
      spy.getCall(messageIndex).lastArg.error ? spy.getCall(messageIndex).lastArg.error.message : "", // If there is an error, add its message.
    ]);
    return lastLogMessage.indexOf(value) !== -1;
  } catch {
    const lastLogMessage = JSON.stringify(spy.getCall(messageIndex).lastArg.message);
    return lastLogMessage.indexOf(value) !== -1;
  }
}

// Helper function used by unit tests to get the most recent log level.
export function lastSpyLogLevel(spy: Spy): string {
  return spy.getCall(-1).lastArg.level;
}

export function spyLogLevel(spy: Spy, messageIndex: number): string {
  return spy.getCall(messageIndex).lastArg.level;
}
