// Keep provider errors useful without forwarding nested transaction data, proofs, or credential-bearing URLs.
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return message
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(/(?:0x)?[a-f0-9]{65,}/gi, "[redacted hex data]")
    .slice(0, 2048);
}
