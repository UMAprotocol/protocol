const PublicNetworks = {
  1: {
    name: "mainnet",
    ethFaucet: null,
    etherscan: "https://etherscan.io/",
    daiAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
  },
  3: {
    name: "ropsten",
    ethFaucet: "https://faucet.metamask.io/",
    etherscan: "https://ropsten.etherscan.io/",
    daiAddress: "0xB5E5D0F8C0cbA267CD3D7035d6AdC8eBA7Df7Cdd",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab"
  },
  4: {
    name: "rinkeby",
    ethFaucet: "https://faucet.rinkeby.io/",
    etherscan: "https://rinkeby.etherscan.io/",
    daiAddress: "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa",
    wethAddress: "0xc778417E063141139Fce010982780140Aa0cD5Ab"
  },
  42: {
    name: "kovan",
    ethFaucet: "https://faucet.kovan.network/",
    etherscan: "https://kovan.etherscan.io/",
    daiAddress: "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99",
    wethAddress: "0xd0A1E359811322d97991E03f863a0C30C2cF029C"
  }
};

module.exports = { PublicNetworks };
