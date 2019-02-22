function stateToString(state) {
  switch (state.toString()) {
    case "0":
      return "Live";
    case "1":
      return "Disputed";
    case "2":
      return "Expired";
    case "3":
      return "Defaulted";
    case "4":
      return "Emergency";
    case "5":
      return "Settled";
    default:
      return "Unknown";
  }
}

module.exports = {
  stateToString
}
