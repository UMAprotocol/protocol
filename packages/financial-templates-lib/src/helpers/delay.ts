export function delay(s: number): Promise<void> {
  return new Promise((r) => setTimeout(r, s * 1000));
}
