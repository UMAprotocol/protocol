const Liquidation = artifacts.require("Liquidation");

contract("Liquidation", function(accounts) {
  const sponsor = accounts[0];
  const liquidator = accounts[1];
  const disputer = accounts[2];
  const rando = accounts[3];

  beforeEach(async () => {
    // Create Collateral and Synthetic ERC20's
    // Set allowances for contract to spend
    // Deploy a Liquidation contract and set global params
  });

  describe("Creating a liquidation", () => {
      it("Liquidator does not have enough tokens to retire position", async () => {

      });
      it("Liquidator has enough tokens to retire position", async () => {

      });
  });

  describe("Liquidation has been created", () => {
      beforeEach(async () => {
        // Create a Liquidation
      });
    
      describe("Get a Liquidation", () => {
          it("Liquidation was created", async () => {
    
          });
          it("Liquidation was not created", async () => {
    
          });
      });


      describe("Dispute a Liquidation", () => {
        it("Liquidation already expired", async () => {
    
        });
        it("Liquidation has already been disputed", async () => {
    
        });
        it("Disputer does not have enough tokens", async () => {
    
        });
        it("Disputer has enough tokens", async () => {
    
        });
        // Weird edge cases, test anyways:
        it("Liquidation disputed successfully", async () => {
    
        });
        it("Liquidation disputed unsuccessfully", async () => {
    
        });
      });
    
      describe('Settle Dispute: there is not pending dispute', () => {
        it('Cannot settle a Liquidation before a dispute request', async () => {

        });
      });
  
      describe("Settle Dispute: there is a pending dispute", () => {
        beforeEach(async () => {
            // Dispute the created liquidation
        })
        it("Settlement price set properly", async () => {
    
        });
        it("Dispute Succeeded", async () => {
    
        });
        it("Dispute Failed", async () => {
    
        });
      });

      describe("Withdraw: Liquidation is pending a dispute", () => {
        beforeEach(async () => {
            // Dispute a liquidation
        })
        it("Sponsor calls", async () => {
    
        });
        it("Liquidator calls", async () => {

        });
        it("Disputer calls", async () => {

        });
        it("Rando calls", async () => {

        });
        it("Still fails even regardless if liquidation expires", async () => {
            // Test pre-expiry
            // Expire contract
            // Test post-expiry
        });
      });
    
      describe("Withdraw: Liquidation expires", () => {
        it("Sponsor calls", async () => {
    
        });
        it("Liquidator calls", async () => {

        });
        it("Disputer calls", async () => {

        });
        it("Rando calls", async () => {

        });
      });

      describe("Withdraw: Liquidation is disputed", () => {
        beforeEach(async() => {
            // Dispute
            // Settle the dispute
        })
        it("Dispute succeeded", async () => {
            it("Sponsor calls", async () => {
    
            });
            it("Liquidator calls", async () => {
    
            });
            it("Disputer calls", async () => {
    
            });
            it("Rando calls", async () => {
    
            });
            it("Withdraw still succeeds even if Liquidation has expired", async () => {

            });
        });
        it("Dispute failed", async () => {
            it("Sponsor calls", async () => {
    
            });
            it("Liquidator calls", async () => {
    
            });
            it("Disputer calls", async () => {
    
            });
            it("Rando calls", async () => {
    
            });
            it("Withdraw still succeeds even if Liquidation has expired", async () => {

            });
        });
      });
  });
});
