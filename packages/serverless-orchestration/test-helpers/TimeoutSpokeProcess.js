// script the sleeps for a defined duration then closes. Can be used to debug hub/spoke interactions.
const { delay } = require("@uma/financial-templates-lib");

async function Run() {
  console.log("Running timeoutsimulatedSpoke");
  await delay(70);
  console.log("Done & closing");
}

Run().then(() => {});
