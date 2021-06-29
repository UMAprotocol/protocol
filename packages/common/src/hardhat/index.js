const fs = require("fs");
const path = require("path");

["tasks"].forEach((folder) =>
  fs.readdirSync(path.join(__dirname, folder)).forEach((mod) => require(path.join(__dirname, folder, mod)))
);
