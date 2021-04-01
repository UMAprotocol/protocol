const { getClaimsForAddress } = require("@uma/merkle-distributor");

exports.getClaimsForAddress = async (req, res) => {
  try {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).send("");
    } else {
      const body = req.body;
      ["merkleDistributorAddress", "claimerAddress", "chainId"].forEach(requiredKey => {
        if (!Object.keys(body).includes(requiredKey))
          throw "Missing key in req body! required: merkleDistributorAddress, claimerAddress, chainId";
      });

      const claims = await getClaimsForAddress(body.merkleDistributorAddress, body.claimerAddress, body.chainId);
      console.log(`Fetched claims for ${JSON.stringify(body)}. Claims: ${JSON.stringify(claims)}`);
      res.status(200).send(claims);
    }
  } catch (e) {
    console.error(e);
    res.status(500).send({ message: "Error in fetching claims", error: e instanceof Error ? e.message : e });
  }
};
