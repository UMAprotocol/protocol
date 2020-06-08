const express = require("express");
const app = express();
const { exec } = require("child_process");

app.get("/", (req, res) => {
  console.log("Daily reporter received a request");

  let reporterScript = exec("/bin/bash ../reporters/cloud-run-scripts/SendSlackReport.sh", (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);

    if (error !== null) {
      console.error(`exec error: ${error}`);
      res.status(400).send({
        message: error
      });
    } else {
      console.log("Daily report generated");
      res.send(`Daily Report sent!`);
    }
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("Listening on port", port);
});
