const foundationWallet = "0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc";

async function runExport() {}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
  }
  callback();
};

run.runExport = runExport;
module.exports = run;
