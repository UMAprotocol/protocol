// This executes an approved admin proposal. This assumes that the admin proposal is one to whitelist an identifier,
// therefore it will check the identifier whitelist afterwards.

const Governor = artifacts.require("Governor");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const argv = require("minimist")(process.argv.slice(), {
  string: ["start", "end"]
});

async function execute(callback) {
  try {
    const governor = await Governor.deployed();

    const end = argv.end || (await governor.numProposals()).subn(1).toString();
    const start = argv.start || end;
    console.log(`Proposing Admin ${start} through Admin ${end}`);

    const gasEstimator = new GasEstimator(
      winston.createLogger({
        silent: true
      }),
      60, // Time between updates.
      100 // Default gas price.
    );

    for (let j = start; j <= end; j++) {
      const proposal = await governor.getProposal(j);
      // for every transactions within the proposal
      console.log(`Starting proposal ${j} with ${proposal.transactions.length} transactions.`);
      for (let i = 0; i < proposal.transactions.length; i++) {
        await gasEstimator.update();
        console.log(`Proposal ${j}, Transaction ${i}: Submitting tx...`);
        let tx = await governor.executeProposal(j.toString(), i.toString(), {
          gasPrice: gasEstimator.getCurrentFastPrice()
        });
        console.log(`${i}: Done: `, tx.tx);
      }
      console.log(`Admin proposal ${j} executed!`);
    }
  } catch (err) {
    console.error(err);
    callback(err);
  }
  callback();
}

module.exports = execute;
