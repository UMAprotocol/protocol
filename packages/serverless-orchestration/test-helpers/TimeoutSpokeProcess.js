const { delay } = require("@uma/financial-templates-lib");

async function Run() {
  console.log("Running timeoutsimulatedSpoke");
  await delay(70);
  console.log("Done & closing");
}

Run().then(() => {}); // Use the default winston logger & env port.
