import Web3 from "web3";

type CharObject = {
  character: string;
  escape: boolean;
  skip: boolean;
};

/**
 * @title Parse ancillary data.
 * @notice Ancillary data parser implementation following guidelines at:
 * https://docs.google.com/document/d/1zhKKjgY1BupBGPPrY_WOJvui0B6DMcd-xDR8-9-SPDw/edit
 * @param {String} hex string representation of ancillaryData
 * @return {Object} parsed ancillary data object.
 */
export function parseAncillaryData(ancillaryData: string): Record<string, unknown> {
  // Some requesting contracts set the synthetic token address as ancillary data, so try to parse it first:
  if (Web3.utils.isAddress(ancillaryData)) return { address: ancillaryData };
  let ancillaryString;
  try {
    ancillaryString = Web3.utils.hexToUtf8(ancillaryData);
  } catch (err) {
    throw new Error("Cannot parse ancillary data bytes to UTF-8!");
  }
  return parseAncillaryString(ancillaryString);
}

// Parses ancillary data string to object.
function parseAncillaryString(ancillaryString: string): Record<string, unknown> {
  const ancillaryObject: Record<string, unknown> = {};
  const stringObject = Array.from(ancillaryString).map((character) => ({ character, escape: false, skip: false }));
  markEscapes(stringObject);
  const keyValues = splitKeyValues(stringObject);
  keyValues.forEach((keyValue: CharObject[]) => {
    const [key, value] = parseKeyValue(keyValue);
    ancillaryObject[key] = value;
  });
  return ancillaryObject;
}

// Escapes double quoted keys/values and values enclosed in curly/square brackets.
function markEscapes(stringObject: CharObject[]) {
  stringObject.forEach((charObject, openIndex, stringObject) => {
    // Skip searching in already escaped characters or closing double quotes:
    if (charObject.escape || charObject.skip) return;

    // Escape keys: opening quotes should be after comma (,) separator or start.
    if (
      charObject.character === '"' &&
      (isNextEnd(stringObject, openIndex, false) || isNextChar(stringObject, openIndex, ",", false))
    )
      escapeQuotes(stringObject, openIndex, false);

    // Escape string values: opening quotes should be after column (:) separator.
    if (charObject.character === '"' && isNextChar(stringObject, openIndex, ":", false))
      escapeQuotes(stringObject, openIndex);

    // Escape JSON values: first opening curly brackets should be after column (:) separator.
    if (charObject.character === "{" && isNextChar(stringObject, openIndex, ":", false))
      escapeJSON(stringObject, openIndex);

    // Escape JSON values: first opening square brackets should be after column (:) separator.
    if (charObject.character === "[" && isNextChar(stringObject, openIndex, ":", false))
      escapeJSON(stringObject, openIndex, false);
  });
}

// Splits ancillary data object into key-value pairs.
function splitKeyValues(stringObject: CharObject[]): CharObject[][] {
  const keyValues: CharObject[][] = [];
  for (let startIndex = 0; startIndex < stringObject.length; startIndex++) {
    const charObject: CharObject = stringObject[startIndex];

    // If reached unescaped comma (,) continue with the next key-value pair:
    if (!skipWhitespace(charObject) || (charObject.character === "," && !charObject.escape)) continue;

    for (let endIndex = startIndex; endIndex < stringObject.length; endIndex++) {
      // Search for next unescaped comma (,) delimiter or end of object:
      if (
        endIndex === stringObject.length - 1 ||
        isNextEnd(stringObject, endIndex) ||
        isNextChar(stringObject, endIndex, ",")
      ) {
        // Copy the identified key-value pair:
        keyValues.push(stringObject.slice(startIndex, endIndex + 1));

        // Skip start index to the end of current key-value pair:
        startIndex = endIndex;
        break;
      }
    }
  }

  // Remove enclosing double quotes.
  return keyValues.map((keyValue: CharObject[]) => keyValue.filter(removeDoubleQuotes));
}

// Tries to parse key:value pair.
function parseKeyValue(keyValue: CharObject[]): [string, unknown] {
  let key = "";
  let value = "";

  // Skip unescaped whitespace:
  let index = keyValue.findIndex(skipWhitespace) === -1 ? keyValue.length : keyValue.findIndex(skipWhitespace);

  while (index < keyValue.length) {
    const skip =
      keyValue.slice(index).findIndex(skipWhitespace) === -1 ? 0 : keyValue.slice(index).findIndex(skipWhitespace);

    // Reached unescaped column (:) delimiter:
    if (keyValue[index + skip].character === ":" && !keyValue[index + skip].escape) {
      index += 1 + skip;
      // Return processed key and empty value if reached the end of keyValue pair:
      if (index === keyValue.length && key) {
        return [key, ""];
      } else {
        break;
      }
    }
    key = key.concat(keyValue[index].character);
    index++;
  }

  // No column (:) delimiter found, but reached the end of keyValue pair:
  if (index === keyValue.length) throw "Cannot parse key value pair: no column delimiter found!";

  // Skip unescaped whitespace
  index +=
    keyValue.slice(index).findIndex(skipWhitespace) === -1
      ? keyValue.slice(index).length
      : keyValue.slice(index).findIndex(skipWhitespace);

  while (index < keyValue.length) {
    const skip =
      keyValue.slice(index).findIndex(skipWhitespace) === -1 ? 0 : keyValue.slice(index).findIndex(skipWhitespace);

    // There should be only one unescaped column (:) delimiter in the keyValue pair:
    if (keyValue[index + skip].character === ":" && !keyValue[index + skip].escape)
      throw "Cannot parse key value pair: multiple column delimiters found!";

    value = value.concat(keyValue[index].character);
    index++;
  }
  if (!key || !value) throw "Cannot parse key value pair!";

  // First try parsing value as JSON object:
  try {
    return [key, JSON.parse(value)];
  } catch (err) {
    // Then parse as Number or return string value:
    if (value === Number(value).toString()) {
      return [key, Number(value)];
    } else {
      return [key, value];
    }
  }
}

// Checks if reached end/start without whitespace.
function isNextEnd(stringObject: CharObject[], start: number, forward = true): boolean {
  if (forward) {
    return stringObject.slice(start + 1).findIndex(skipWhitespace) === -1;
  } else {
    return stringObject.slice(0, start).reverse().findIndex(skipWhitespace) === -1;
  }
}

// Checks if next non-whitespace character forward/backward matches the provided input character.
export function isNextChar(stringObject: CharObject[], start: number, character: string, forward = true): boolean {
  if (forward) {
    const nextCharIndex = stringObject.slice(start + 1).findIndex(skipWhitespace);
    if (nextCharIndex === -1) {
      return false;
    } else {
      return (
        stringObject[start + 1 + nextCharIndex].character === character &&
        !stringObject[start + 1 + nextCharIndex].escape
      );
    }
  } else {
    const nextCharIndex = stringObject.slice(0, start).reverse().findIndex(skipWhitespace);
    if (nextCharIndex === -1) {
      return false;
    } else {
      return (
        stringObject[start - 1 - nextCharIndex].character === character &&
        !stringObject[start - 1 - nextCharIndex].escape
      );
    }
  }
}

/**
 * Finds closing quotes for keys/values and marks escaped.
 * For values: closing quotes should be either before comma (,) or at the end.
 * For keys: closing quotes should be before column (:).
 */
function escapeQuotes(stringObject: CharObject[], openIndex: number, escapeValues = true) {
  const nextCharFn = escapeValues
    ? function (stringObject: CharObject[], closeIndex: number): boolean {
        return isNextEnd(stringObject, closeIndex) || isNextChar(stringObject, closeIndex, ",");
      }
    : function (stringObject: CharObject[], closeIndex: number): boolean {
        return isNextChar(stringObject, closeIndex, ":");
      };
  for (let closeIndex = openIndex + 1; closeIndex < stringObject.length; closeIndex++) {
    if (stringObject[closeIndex].character === '"' && nextCharFn(stringObject, closeIndex)) {
      for (let i = openIndex + 1; i < closeIndex; i++) {
        stringObject[i].escape = true;
      }
      stringObject[openIndex].skip = true;
      stringObject[closeIndex].skip = true;
      break;
    }
  }
}

// Finds closing brackets for JSON value and marks escaped: last closing brackets should be either before comma (,) or at the end.
function escapeJSON(stringObject: CharObject[], openIndex: number, curly = true) {
  const openChar = curly ? "{" : "[";
  const closeChar = curly ? "}" : "]";
  let nestingLevel = 1;
  for (let closeIndex = openIndex + 1; closeIndex < stringObject.length; closeIndex++) {
    if (stringObject[closeIndex].character === openChar) nestingLevel++;
    if (stringObject[closeIndex].character === closeChar) nestingLevel--;
    if (
      stringObject[closeIndex].character === closeChar &&
      nestingLevel === 0 &&
      (isNextEnd(stringObject, closeIndex) || isNextChar(stringObject, closeIndex, ","))
    ) {
      for (let i = openIndex + 1; i < closeIndex; i++) {
        stringObject[i].escape = true;
      }
      break;
    }
  }
}

// Checks whether the passed character object does not represent whitespace.
function skipWhitespace(charObject: CharObject): boolean {
  const whitespaceCharacters = Array.from(" \t\n\r");
  return !whitespaceCharacters.includes(charObject.character) || charObject.escape;
}

// Used to filter out double quotes.
function removeDoubleQuotes(charObject: CharObject): boolean {
  return !charObject.skip;
}
