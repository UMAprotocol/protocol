#!/usr/bin/env node

const path = require("path");
const proc = require("child_process");
const startCase = require("lodash.startcase");

const mapFile = process.argv[2];
const baseDir = process.argv[3];

// Path should look like:
// modules/.../section_name/pages
const pathArr = baseDir.split("/");
const moduleName = pathArr[pathArr.length - 2];

console.log("." + startCase(moduleName));

// Special case for contracts.
if (moduleName === "contracts") {
  const files = proc
    .execFileSync("find", [baseDir, "-type", "f"], { encoding: "utf8" })
    .split("\n")
    .filter((s) => s !== "");

  for (const file of files) {
    const doc = file.replace(baseDir, "");
    const title = path.parse(file).name;
    console.log(`* xref:${doc}[${startCase(title)}]`);
  }

  return;
}

// Read the map file in
const lines = require("fs").readFileSync(mapFile, "utf-8").split("\n").filter(Boolean);

const moduleIndex = lines.findIndex((line) => line.startsWith(`* ${moduleName}`));

if (moduleIndex === -1) {
  throw `Could not find ${moduleName} module in mapFile`;
}

for (let i = moduleIndex + 1; i < lines.length; i++) {
  const line = lines[i];
  const depth = (line.match(/\*/g) || []).length;

  // Reached another top level.
  if (depth === 1) {
    break;
  }

  const prefix = `${"*".repeat(depth - 1)} `;
  const name = line.split(" ")[1];

  if (name.includes(".")) {
    const baseName = name.split(".")[0];
    console.log(`${prefix} xref:${baseName}.adoc[${startCase(baseName)}]`);
  } else {
    console.log(`${prefix} ${startCase(name)}`);
  }
}
