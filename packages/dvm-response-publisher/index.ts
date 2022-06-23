import Web3 from "web3";
import type { EventData } from "web3-eth-contract";
// import type { VotingWeb3, OracleHubWeb3, OracleSpokeWeb3 } from "@uma/contracts-node";
import { getAbi, getAddress } from "@uma/contracts-node";
import "dotenv/config";
// import Logger from "@uma/financial-templates-lib";

run();

async function run() {
  const NETWORK = "mainnet";
  const CHAIN_ID = 1;
  const web3 = new Web3(`https://${NETWORK}.infura.io/v3/${process.env.INFURA_ID}`);
  // voting
  const VOTING_ABI = getAbi("Voting");
  const VOTING_ADDRESS = await getAddress("Voting", CHAIN_ID);
  const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS);

  // const ORACLE_HUB_ABI = getAbi("OracleHub");
  // const ORACLE_HUB_ADDRESS = await getAddress("OracleHub", CHAIN_ID);
  // const oracleHub = new web3.eth.Contract(ORACLE_HUB_ABI, ORACLE_HUB_ADDRESS);

  // const ORACLE_SPOKE_ABI = getAbi("OracleSpoke");
  // const ORACLE_SPOKE_ADDRESS = await getAddress("OracleSpoke", 10);
  // const oracleSpoke = new web3.eth.Contract(ORACLE_SPOKE_ABI, ORACLE_SPOKE_ADDRESS);

  const priceRequestEvents = await voting.getPastEvents("PriceRequestAdded", {
    fromBlock: 0,
    toBlock: "latest",
  });

  console.log(priceRequestEvents.map(getReturnValues));
}

function getReturnValues(event: EventData) {
  console.log(event.returnValues);
  const { identifier, time } = event.returnValues;

  return { identifier, time };
}
