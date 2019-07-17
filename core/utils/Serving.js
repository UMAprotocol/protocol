const express = require("express");
const { decorateApp } = require("@awaitjs/express");
const app = decorateApp(express());

// Calls a function on every request.
async function triggerOnRequest(fn) {
  // GCP PubSub pushes come as POSTs.
  app.postAsync("/", async (req, res) => {
    console.log("Received a request.");

    await fn();
    res.status(200).send("Done.");
    console.log("Finished processing request.");
  });

  app.listen(process.env.PORT, () => {
    console.log("Listening on port", process.env.PORT);
  });
}

module.exports = {
  triggerOnRequest
};
