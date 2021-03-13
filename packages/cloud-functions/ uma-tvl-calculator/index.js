const { calculateCurrentTvl } = require("@uma/merkle-distributor");

exports.calculateCurrentTvl = async (req, res) => {
  try {
    res.status(200).send(await calculateCurrentTvl());
  } catch (error) {
    console.log("something went wrong fetching the tvl", error);
    res.status(400).send({ message: "something went wrong fetching the tvl", error: error.message });
  }
};
