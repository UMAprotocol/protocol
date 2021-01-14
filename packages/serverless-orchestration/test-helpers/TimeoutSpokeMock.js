const express = require("express");
const timeoutSpoke = express();
timeoutSpoke.use(express.json()); // Enables json to be parsed by the express process.

const { delay } = require("@uma/financial-templates-lib");

let responseDelay;

timeoutSpoke.post("/", async (req, res) => {
  console.log("inbound delay call...waiting");
  await delay(responseDelay);
  res.status(200).send({ message: `returned after ${responseDelay}` });
});
async function Poll(port = 8080, _responseDelay = 5) {
  responseDelay = _responseDelay;
  return timeoutSpoke.listen(port, () => {
    console.log(`timeout timeoutSpoke mock with ${responseDelay} responseDelay listening...`);
  });
}
timeoutSpoke.Poll = Poll;
module.exports = timeoutSpoke;
