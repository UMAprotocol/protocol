// Shared test helpers for serverless-orchestration tests

// Simple getContract implementation for testing
function getContract() {
  return {
    deployed: async () => {
      // For testing, we'll create a mock contract instance with a hardcoded address
      const mockAddress = "0x181624443B104B040F99D013D62b7A92Ee3C15f0";
      return { options: { address: mockAddress } };
    }
  };
}

module.exports = {
  getContract
};
