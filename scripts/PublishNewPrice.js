const { getNewWeb3, convertContractToNewWeb3 } = require("./Web3Lib.js");
var Derivative = artifacts.require("Derivative");
var Registry = artifacts.require("Registry");
var Vote = artifacts.require("VoteCoin");

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// const delay = 60;
const delay = 86400;

module.exports = async function(callback) {
try {
  web3 = getNewWeb3(web3);
  var vote = convertContractToNewWeb3(web3, await Vote.deployed());
  var randomValue = getRandomInt(180, 220);
  var initialTime = Number((await vote.methods.latestUnverifiedPrice().call())[0]);
  var timeToAdd;
  if (initialTime == 0) {
    timeToAdd = (await vote.methods.getCurrentCommitRevealPeriods().call())[0][0];
  } else {
    timeToAdd = initialTime + delay;
  }

  var ownerAccount = (await web3.eth.getAccounts())[0];

  await vote.methods.setCurrentTime(timeToAdd.toString()).send({from: ownerAccount, gas: 6720000});
  await vote.methods.addUnverifiedPrice([web3.utils.toWei(randomValue.toString()), timeToAdd.toString()]).send({from: ownerAccount, gas: 6720000});
  try {
    await vote.methods.validatePrices().send({from: ownerAccount, gas: 6720000});
  } catch (error) {
    console.log("validate failed");
  }

  console.log("New Price (ETH): " + randomValue.toString());
  console.log("New Time: " + timeToAdd);
  console.log(await vote.methods.latestUnverifiedPrice().call());

  console.log(await vote.methods.getDefaultProposalPrices().call());
  console.log(await vote.methods.getCurrentPeriodType().call());
  console.log(await vote.methods.latestUnverifiedPrice().call());
  console.log(await vote.methods.latestVerifiedPrice().call());
  callback();
  } catch (error) {
    return callback(error);
}
};
