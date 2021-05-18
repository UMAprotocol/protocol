const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

exports.fetchLatestTvl = async (req, res) => {
  try {
    res.set("Access-Control-Allow-Origin", "*");
    const [result] = await datastore.runQuery(
      datastore.createQuery("UmaTvl").order("created", { descending: true }).limit(1)
    );
    const responseObject = { currentTvl: result[0].tvl, currentTime: result[0].created };
    console.log(`Fetched TVL from data store: ${JSON.stringify(responseObject)}`);
    res.status(200).send(responseObject);
  } catch (e) {
    console.error(e);
    res.status(500).send({ message: "Error in fetching TVL", error: e instanceof Error ? e.message : e });
  }
};
