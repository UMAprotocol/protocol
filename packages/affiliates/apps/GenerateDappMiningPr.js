require("dotenv").config();
const { makeUnixPipe, dappMiningPrTemplate } = require("../libs/affiliates/utils");

const App = async params => {
  const prTemplate = await dappMiningPrTemplate(params);
  return {
    prTemplate,
    ...params
  };
};

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error);
