import { ApolloClient, InMemoryCache } from "@apollo/client";

export const client = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/nicholaspai/mainnet-voting-staging",
  cache: new InMemoryCache()
});
