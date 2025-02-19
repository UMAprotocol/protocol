import ethers, { BigNumber } from "ethers";

export function decodeMultipleQueryPriceAtIndex(encodedPrice: BigNumber, index: number): number {
  if (index < 0 || index > 6) {
    throw new Error("Index out of range");
  }
  // Shift the bits of encodedPrice to the right by (32 * index) positions.
  // This moves the desired 32-bit segment to the least significant bits.
  // Then, we use bitwise AND with 0xffffffff (as a BigNumber) to extract that segment.
  return encodedPrice
    .shr(32 * index)
    .and(BigNumber.from("0xffffffff"))
    .toNumber();
}

export function encodeMultipleQuery(values: string[]): string {
  if (values.length > 7) {
    throw new Error("Maximum of 7 values allowed");
  }
  let encodedPrice = BigNumber.from(0);
  for (let i = 0; i < values.length; i++) {
    if (!values[i]) {
      throw new Error("All values must be defined");
    }
    const numValue = Number(values[i]);
    if (!Number.isInteger(numValue)) {
      throw new Error("All values must be integers");
    }
    if (numValue > 0xffffffff || numValue < 0) {
      throw new Error("Values must be uint32 (0 <= value <= 2^32 - 1)");
    }
    // Shift the current value by 32 * i bits (placing the first value at the LSB)
    // then OR it into the encodedPrice.
    encodedPrice = encodedPrice.or(BigNumber.from(numValue).shl(32 * i));
  }
  return encodedPrice.toString();
}

export function decodeMultipleQuery(price: string, length: number): string[] | string {
  const result: number[] = [];
  const bigNumberPrice = BigNumber.from(price);
  if (isUnresolvable(price)) {
    return price;
  }
  for (let i = 0; i < length; i++) {
    const value = decodeMultipleQueryPriceAtIndex(bigNumberPrice, i);
    result.push(value);
  }
  return result.map((x) => x.toString());
}

export function isTooEarly(price: BigNumber | string): boolean {
  if (typeof price === "string") {
    return price === ethers.constants.MinInt256.toString();
  } else {
    return price.eq(ethers.constants.MinInt256);
  }
}

export function isUnresolvable(price: BigNumber | string): boolean {
  if (typeof price === "string") {
    return price === ethers.constants.MaxInt256.toString();
  } else {
    return price.eq(ethers.constants.MaxInt256);
  }
}
