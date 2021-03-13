const { getClaimsForAddress } = require("@uma/merkle-distributor");

exports.getClaimsForAddress = async (req, res) => {
  try {
    const b = req.body;
    ["merkleDistributorAddress", "claimerAddress", "chainId"].forEach(requiredKey => {
      if (!Object.keys(b).includes(requiredKey))
        throw "missing key in req body! required: merkleDistributorAddress, claimerAddress, chainId";
    });

    const claimsForAddress = await getClaimsForAddress(b.merkleDistributorAddress, b.claimerAddress, b.chainId);
    console.log("fetched claims for address", claimsForAddress);
    res.status(200).send(claimsForAddress);
  } catch (error) {
    console.error(error);
    res.status(400).send(error.message);
  }
};
