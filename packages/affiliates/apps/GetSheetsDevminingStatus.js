// This grabs the latest state from dev mining. Outputs it into a format which can be used in multiple ways.
// Can be used to generate issue in github, or dev mining configuration, or updating dev mining status github.
// This Requires ENV vars or .env file and a user with access to our private dev mining spreadsheet
// GOOGLE_CREDENTIALS - set up sheet api https://developers.google.com/sheets/api/quickstart/nodejs
// SHEET_ID - the sheet ID in the url to the dev mining sheet
// GOOGLE_TOKEN_PATH - oath2 will need to save a token to your drive. Recommend /tmp/google_token
// Run script: node apps/GetSheetDevminingStatus
require("dotenv").config();
const assert = require("assert");
const fs = require("fs");
const { google } = require("googleapis");
const prompt = require("prompt");
const web3 = require("web3");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const EMP_ENABLED_STATE = "1";
// Hardcodes columns and names based on the shape of the current dev mining sheet. May want this as config in future.
const SHEET_COLUMNS = [
  // Name of prop in final object, column number in sheet and optional mapping function for value
  ["name", 0],
  ["identifier", 1],
  ["payoutAddress", 2, parseAddress],
  ["empAddress", 4, parseAddressFromEtherscan],
  ["enabled", 5, isEnabled]
];

function getRangeString(rows = 100, tab = "Developer Mining") {
  return `${tab}!1:${rows}`;
}

// GDrive Specific: have to use oauth credentials.
async function auth(credentials) {
  assert(credentials, "requires credential object");
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

function writeObject(path, obj) {
  assert(path, "requires a path to write object");
  return fs.writeFileSync(path, JSON.stringify(obj));
}
function readObject(path) {
  assert(path, "requires a path to read object");
  return JSON.parse(fs.readFileSync(path));
}

async function getNewToken(oAuth2Client) {
  assert(oAuth2Client, "requires oath2client");
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  prompt.start();
  const { code } = await prompt.get(["code"]);
  console.log("got code:", code);
  return oAuth2Client.getToken(code);
}

// This assumes URL in the format https://etherscan.io/address/0xd81028a6fbaaaf604316f330b20d24bfbfd14478
// Which could be quite fragile, but works for now.
function parseAddressFromEtherscan(url) {
  const addr = url.split("/")[4];
  return parseAddress(addr);
}
// Validates an eth address and upgrades it to checksum address
function parseAddress(addr) {
  assert(web3.utils.isAddress(addr), "Invalid Eth address: " + addr);
  return web3.utils.toChecksumAddress(addr);
}

// Assumes dev mining status column === 1 for active emp
function isEnabled(enabled, enabledState = EMP_ENABLED_STATE) {
  return enabled == enabledState;
}

// Parses the raw data from sheet
function parseSheet(sheet, columns = SHEET_COLUMNS) {
  return sheet.values.reduce((result, row) => {
    const parsed = columns.reduce((result, [name, index, map]) => {
      try {
        result[name] = map ? map(row[index]) : row[index];
      } catch (err) {
        console.log("error in row:" + row, err);
      }
      return result;
    }, {});
    result.push(parsed);
    return result;
  }, []);
}

// Filters out inactive emp addresses
function filterActive(list) {
  return list.filter(data => {
    return data.empAddress && data.empAddress.length && data.payoutAddress && data.payoutAddress.length && data.enabled;
  });
}

// Main entrypoint. Sets up google sheet auth, reads sheet and returns to log.
async function run() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const authClient = await auth(credentials);
  let token;
  try {
    token = readObject(process.env.GOOGLE_TOKEN_PATH);
  } catch (err) {
    token = await getNewToken(authClient);
    writeObject(process.env.GOOGLE_TOKEN_PATH, token);
  }
  authClient.setCredentials(token.tokens);

  const sheets = google.sheets({ version: "v4", auth: authClient });
  const request = {
    spreadsheetId: process.env.SHEET_ID,
    // / Get 100 rows. Skips first row which is header info.
    range: getRangeString(100)
  };
  const result = await sheets.spreadsheets.values.get(request);
  return filterActive(parseSheet(result.data));
}

run()
  .then(console.log)
  .catch(console.log);
