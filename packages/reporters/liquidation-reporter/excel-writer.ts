// This script takes in info from the liquidation reporter and builds an excel spreadsheet containing condensed information.

const xl = require("excel4node");

export function createExcelSheetFromLiquidationDrawDownData(drawDownData: any) {
  // Create a new instance of a Workbook class
  const wb = new xl.Workbook();

  const boldStyle = wb.createStyle({ font: { bold: true } });

  Object.keys(drawDownData).forEach((collateralAddress: string) => {
    const collateralData = drawDownData[collateralAddress];
    const sheet = wb.addWorksheet(collateralData.collateralSymbol);

    // Heading
    sheet
      .cell(1, 1)
      .string(`Collateral: ${collateralData.collateralSymbol}`)
      .style({ font: { size: 16, bold: true } });

    // Collateral info
    sheet.cell(2, 1).string("Collateral Price(USD)").style(boldStyle);
    sheet.cell(2, 2).number(Number(collateralData.collateralPriceInUsd));
    sheet.cell(3, 1).string("Collateral TVL(USD)").style(boldStyle);
    sheet.cell(3, 2).number(Number(Number(collateralData.collateralValueInUsd).toFixed(2)));
    sheet.cell(4, 1).string("Collateral Address").style(boldStyle);
    sheet.cell(4, 2).string(collateralAddress);

    // Financial contracts list
    sheet
      .cell(2, 7)
      .string(`Financial Contracts that use ${collateralData.collateralSymbol}`)
      .style({ font: { size: 14, bold: true } });
    sheet.cell(3, 7).string("Contract Address").style(boldStyle);
    sheet.column(7).setWidth("Contract Address".length);
    sheet.cell(3, 8).string("Value In Contract(USD)").style(boldStyle);
    sheet.column(8).setWidth("Value In Contract(USD)".length);
    sheet.cell(3, 9).string("Price Identifier").style(boldStyle);
    sheet.column(9).setWidth("Price Identifier".length);
    sheet.cell(3, 10).string("Expiration Time").style(boldStyle);
    sheet.column(10).setWidth("Expiration Time".length);
    sheet.cell(3, 11).string("Collateral Requirement").style(boldStyle);
    sheet.column(11).setWidth("Collateral Requirement".length);
    collateralData.activeFinancialContracts.sort((a: any, b: any) =>
      Number(a.collateralValueInUsd) < Number(b.collateralValueInUsd)
        ? 1
        : Number(b.collateralValueInUsd) < Number(a.collateralValueInUsd)
        ? -1
        : 0
    );

    collateralData.activeFinancialContracts.forEach((financialContractInfo: any, index: number) => {
      sheet.cell(4 + index, 7).string(financialContractInfo.contractAddress || "unknown address");
      sheet.cell(4 + index, 8).number(Number(Number(financialContractInfo.collateralValueInUsd).toFixed(2)) || 0);
      sheet.cell(4 + index, 9).string(financialContractInfo.contractPriceIdentifier || "unknown identifier");
      if (financialContractInfo.contractExpirationTime && financialContractInfo.contractExpirationTime != "perpetual")
        sheet.cell(4 + index, 10).date(new Date(financialContractInfo.contractExpirationTime * 1000));
      else sheet.cell(4 + index, 10).string("perpetual");
      sheet.cell(4 + index, 11).number(financialContractInfo.collateralRequirement || 0);
    });

    // DrawDown prices
    sheet.cell(6, 1).string("Drawdown Percent").style(boldStyle);
    sheet.column(1).setWidth("Drawdown Percentage".length);
    sheet.cell(6, 2).string("Drawdown Price(USD)").style(boldStyle);
    sheet.column(2).setWidth("Drawdown Price(USD)".length);
    sheet.cell(6, 3).string(`Liquidated Collateral(${collateralData.collateralSymbol})`).style(boldStyle);
    sheet.column(3).setWidth(`Liquidated Collateral(${collateralData.collateralSymbol})`.length);
    sheet.cell(6, 4).string("USD To Liquidate Collateral").style(boldStyle);
    sheet.column(4).setWidth("USD To liquidate Collateral".length);
    collateralData.drawDownAmounts.forEach((drawDownData: any, index: number) => {
      sheet.cell(7 + index, 1).number(Number(drawDownData.priceDrop) || 0);
      sheet.cell(7 + index, 2).number(Number(drawDownData.effectiveCollateralPrice) || 0);
      sheet.cell(7 + index, 3).number(Number(drawDownData.collateralLiquidated) || 0);
      sheet.cell(7 + index, 4).number(Number(drawDownData.usdNeededToLiquidate) || 0);
    });
  });

  // Finally save the file with the date formatted year-month-day
  const dateName = new Date().toISOString().split("T")[0];
  wb.write(`${dateName}-liquidation-drawdown-report.xlsx`);
}
