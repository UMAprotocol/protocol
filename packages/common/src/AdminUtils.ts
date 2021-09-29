const adminPrefix = "Admin ";

export function isAdminRequest(identifierUtf8: string): boolean {
  return identifierUtf8.startsWith(adminPrefix);
}

// Assumes that `identifierUtf8` is an admin request, i.e., `isAdminRequest()` returns true for it.
export function getAdminRequestId(identifierUtf8: string): number {
  return parseInt(identifierUtf8.slice(adminPrefix.length), 10);
}

// Vote 1 for Yes, 0 for No. Any vote > 0 is technically a Yes, but the 1 is treated as the canonical yes.
export const translateAdminVote = (voteValue: string): string => {
  if (!voteValue) {
    return "No Vote";
  } else {
    switch (voteValue.toString()) {
      case "1.0":
        return "YES";
      case "1":
        return "YES";
      case "0":
        return "NO";
      case "0.0":
        return "NO";
      default:
        return "INVALID ADMIN VOTE";
    }
  }
};
