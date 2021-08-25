// Plugin notes:
// The plugin adds 4 methods to the hre: getContract, findEvent, assertEventEmitted, assertEventNotEmitted.
// It requires the web3 hardhat plugin to work. All contract instantiations are web3, not truffle.
//
// getContract usage:
//   const { getContract } = hre;
//   const Voting = getContract("Voting");
//
//   // Get deployed voting contract for network.
//   const voting = await Voting.deployed();
//
//   // Create new Voting contract.
//   const voting = await Voting.new(arg1, arg2, ...).send({ from: accounts[0] });
//
//   // Instantiate voting contract at address.
//   const voting = Voting.at(someAddress);
//
// findEvent, assertEventEmitted, and assertEventNotEmitted usage:
//   const { findEvent, assertEventEmitted, assertEventNotEmitted } = hre;
//   ...
//   const result = voting.methods.someMethod(arg1, arg2, ...).send({ from: accounts[0] });
//   const matchOrUndefined = findEvent(result, voting, "SomeEventName",
//                            eventReturnValues => eventReturnValues.someValueICareAbout === 5);
//   await assertEventEmitted(result, voting, "SomeEventName",
//                            eventReturnValues => eventReturnValues.someValueICareAbout === 5);
//   await assertEventNotEmitted(result, voting, "SomeEventName",
//                            eventReturnValues => eventReturnValues.someValueICareAbout === 5);
//

import { extendEnvironment } from "hardhat/config";
import type { HardhatRuntimeEnvironment, Artifact } from "hardhat/types";
import type { ContractSendMethod, Contract, EventData } from "web3-eth-contract";
import type Web3 from "web3";
import type { DeploymentsExtension } from "hardhat-deploy/types";

export interface ContractFactory extends Artifact {
  deployed: () => Promise<Contract>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new: (...args: any[]) => ContractSendMethod;
  at: (address: string) => Contract;
}

type FindEventFunction = (
  txnResult: { blockNumber: number },
  contract: Contract,
  eventName: string,
  fn: (eventValues: EventData["returnValues"]) => boolean
) => Promise<{
  match: EventData | undefined;
  allEvents: EventData["returnValues"][];
}>;

export interface Extension {
  _artifactCache: { [name: string]: Artifact };
  getContract: (
    name: string,
    artifactOverrides?: { abi?: any[]; bytecode?: string; [key: string]: any }
  ) => ContractFactory;
  findEvent: FindEventFunction;
  assertEventEmitted: (...args: Parameters<FindEventFunction>) => void;
  assertEventNotEmitted: (...args: Parameters<FindEventFunction>) => void;
}

interface OtherExtensions {
  web3: Web3;
  deployments: DeploymentsExtension;
}

type HRE = Extension & OtherExtensions & HardhatRuntimeEnvironment;

extendEnvironment((_hre) => {
  const hre = _hre as HRE;
  hre._artifactCache = {};
  hre.getContract = (name, artifactOverrides = {}) => {
    if (!hre._artifactCache[name]) hre._artifactCache[name] = hre.artifacts.readArtifactSync(name);
    const artifact = { ...hre._artifactCache[name], ...artifactOverrides };

    const deployed = async () => {
      const deployment = await hre.deployments.get(name);
      return new hre.web3.eth.Contract(artifact.abi, deployment.address);
    };

    const newProp = (...args: any[]) =>
      new hre.web3.eth.Contract(artifact.abi, undefined).deploy({ data: artifact.bytecode, arguments: args });

    const at = (address: string) => new hre.web3.eth.Contract(artifact.abi, address);

    return { ...artifact, deployed, new: newProp, at };
  };

  hre.findEvent = async (
    txnResult,
    contract,
    eventName,
    fn: (eventValues: EventData["returnValues"]) => boolean = () => true
  ) => {
    // TODO: this can be improved by making sure the event falls in the correct transaction.
    const events = await contract.getPastEvents(eventName, {
      fromBlock: txnResult.blockNumber,
      toBlock: txnResult.blockNumber,
    });

    return {
      match: events.find((event) => fn(event.returnValues)),
      allEvents: events.map((event) => event.returnValues),
    };
  };

  hre.assertEventEmitted = async (txnResult, contract, eventName, fn) => {
    const { match, allEvents } = await hre.findEvent(txnResult, contract, eventName, fn);

    if (match === undefined) {
      throw new Error(
        `No matching events found. Events found:\n\n${allEvents.map((event) => JSON.stringify(event)).join("\n\n")}`
      );
    }
  };

  hre.assertEventNotEmitted = async (txnResult, contract, eventName, fn) => {
    const { match } = await hre.findEvent(txnResult, contract, eventName, fn);

    if (match !== undefined) {
      throw new Error(`Matching event found:\n\n${JSON.stringify(match)}`);
    }
  };
});
