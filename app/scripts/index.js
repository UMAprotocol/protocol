// Import the page's CSS. Webpack will know what to do with it.
import '../styles/app.css'

// Import libraries we need.
import {
  default as Web3
} from 'web3'
import {
  default as contract
} from 'truffle-contract'

// Import our contract artifacts and turn them into usable abstractions.
import voteCoinArtifact from '../../build/contracts/VoteCoin.json'

// MetaCoin is our usable abstraction, which we'll use through the code below.
const VoteCoin = contract(voteCoinArtifact)

// The following code is simple to show off interacting with your contracts.
// As your needs grow you will likely need to change its form and structure.
// For application bootstrapping, check out window.addEventListener below.
let accounts
let account

const App = {
  start: function() {
    const self = this
    // Bootstrap the MetaCoin abstraction for Use.
    VoteCoin.setProvider(web3.currentProvider)

    // Get the initial account balance so it can be displayed.
    web3.eth.getAccounts(function(err, accs) {
      if (err != null) {
        alert('There was an error fetching your accounts.')
        return
      }

      if (accs.length === 0) {
        alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.")
        return
      }

      accounts = accs
      account = accounts[0]

      self.fetchPrice()
      // Also need call to function that updates prices on page here
    })
  },

  setStatus: function(message) {
    const status = document.getElementById('status')
    status.innerHTML = message
  },

  fetchPrice: function() {
    VoteCoin.deployed().then(function(instance) {
      return instance.ETHUSD.call()
    }).then(function(value) {
      const balanceElement = document.getElementById('price')
      balanceElement.innerHTML = value
      console.log("We have a new price!", value)
    }).catch(function(e) {
      console.log(e)
      this.setStatus('Error getting balance; see log.')
    })
    },

  voteYes: function() {
      VoteCoin.deployed().then(function(instance) {
          return instance.currVoteId.call()
      }).then(function(value) {return value.toNumber()}).then(function(voteId) {
          VoteCoin.deployed().then(function(instance) {
              instance.vote(voteId, 1, {from: account})
          })
      }).catch(function(e) {
          console.log(e)
      })
  },

  voteNo: function() {
      VoteCoin.deployed().then(function(instance) {
          return instance.currVoteId.call()
      }).then(function(value) {return value.toNumber()}).then(function(voteId) {
          VoteCoin.deployed().then(function(instance) {
              instance.vote(voteId, 0, {from: account})
          })
      }).catch(function(e) {
          console.log(e)
      })
  },

}

window.App = App

window.addEventListener('load', function() {
  // Checking if Web3 has been injected by the browser (Mist/MetaMask)
  if (typeof web3 !== 'undefined') {
    console.warn(
      'Using web3 detected from external source.' +
      ' If you find that your accounts don\'t appear or you have 0 MetaCoin,' +
      ' ensure you\'ve configured that source properly.' +
      ' If using MetaMask, see the following link.' +
      ' Feel free to delete this warning. :)' +
      ' http://truffleframework.com/tutorials/truffle-and-metamask'
    )
    // Use Mist/MetaMask's provider
    window.web3 = new Web3(web3.currentProvider)
  } else {
    console.warn(
      'No web3 detected. Falling back to http://127.0.0.1:9545.' +
      ' You should remove this fallback when you deploy live, as it\'s inherently insecure.' +
      ' Consider switching to Metamask for development.' +
      ' More info here: http://truffleframework.com/tutorials/truffle-and-metamask'
    )
    // fallback - use your fallback strategy (local node / hosted node + in-dapp id mgmt / fail)
    window.web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:9545'))
  }

  App.start()
})
