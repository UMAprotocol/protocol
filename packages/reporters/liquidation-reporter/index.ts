const { fetchUmaEcosystemData } = require("./liquidation-reporter");
const { createExcelSheetFromLiquidationDrawDownData } = require("./excel-writer");

async function fetchDataAndWriteToExcelFile() {
  const ecosystemData = await fetchUmaEcosystemData();
  createExcelSheetFromLiquidationDrawDownData(ecosystemData);
}

fetchDataAndWriteToExcelFile()
  .then(() => {
    setTimeout(function () {
      process.exit(0);
    }, 2000);
  })
  .catch(() => {
    process.exit(1);
  });
