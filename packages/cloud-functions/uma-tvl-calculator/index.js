const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

const { calculateCurrentTvl } = require("@uma/merkle-distributor");

exports.calculateCurrentTvl = async (req, res) => {
  try {
    const tvl = await calculateCurrentTvl();

    const currentTime = Math.round(new Date().getTime() / 1000);
    const key = datastore.key(["UmaTvl", currentTime]);
    const dataBlob = {
      key: key,
      data: {
        tvl: tvl.currentTvl,
        created: currentTime
      }
    };
    await datastore.save(dataBlob);

    console.log(`Fetched and saved current TVL: ${JSON.stringify(tvl)}`);
    res.status(200).send(tvl);
  } catch (e) {
    console.error(e);
    res.status(500).send({ message: "Error in fetching and saving TVL", error: e instanceof Error ? e.message : e });
  }
};
