const { calculateCurrentTvl } = require("@uma/merkle-distributor");

exports.calculateCurrentTvl = async (req, res) => {
  try {
    const tvl = await calculateCurrentTvl();
    console.log(`Fetched current TVL: ${JSON.stringify(tvl)}`);
    res.status(200).send(tvl);
  } catch (e) {
    console.error(e);
    res.status(500).send({ message: "Error in fetching TVL", error: e instanceof Error ? e.message : e });
  }
};
