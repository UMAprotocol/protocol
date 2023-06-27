import retry, { Options as RetryOptions } from "async-retry";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { ethersUtils, getOgByAddress, Logger, MonitoringParams, SupportedBonds } from "./common";
import { GraphqlData, parseRules, RulesParameters, SnapshotProposalGraphql } from "./SnapshotVerification";

interface SupportedParameters {
  parsedRules: RulesParameters;
  currency: string;
  bond: string;
}

interface SupportedModules {
  [ogAddress: string]: SupportedParameters;
}

// Checks that currency is among supportedBonds and that the bond amount exactly matches.
const isBondSupported = (currency: string, bond: string, supportedBonds?: SupportedBonds): boolean => {
  for (const supportedCurrency in supportedBonds) {
    if (ethersUtils.getAddress(currency) === ethersUtils.getAddress(supportedCurrency)) {
      return supportedBonds[supportedCurrency] === bond;
    }
  }
  return false;
};

// Filters through all monitored OGs and returns all supported modules with their parameters. Specifically, this checks
// that standard parsable rules are present and that the bond currency and amount is supported.
const getSupportedModules = async (params: MonitoringParams): Promise<SupportedModules> => {
  const supportedModules: SupportedModules = {};

  await Promise.all(
    params.ogAddresses.map(async (ogAddress) => {
      const og = await getOgByAddress(params, ogAddress);
      const rules = await og.rules();
      const parsedRules = parseRules(rules);
      const currency = await og.collateral();
      const bond = (await og.bondAmount()).toString();
      if (parsedRules !== null && isBondSupported(currency, bond, params.supportedBonds))
        supportedModules[ogAddress] = { parsedRules, currency, bond };
    })
  );

  return supportedModules;
};

// Queries snapshot for all space proposals that have been closed and have a plugin of safeSnap. The query also filters
// only for basic type proposals that oSnap automation supports. This uses provided retry config, but ultimately throws
// if the Snapshot query fails after all retries.
const getSnapshotProposals = async (
  spaceId: string,
  url: string,
  retryOptions: RetryOptions
): Promise<Array<SnapshotProposalGraphql>> => {
  const query = gql(/* GraphQL */ `
    query GetProposals($spaceId: String) {
      proposals(
        where: { space: $spaceId, type: "basic", plugins_contains: "safeSnap", scores_state: "final", state: "closed" }
        orderBy: "created"
        orderDirection: desc
      ) {
        ipfs
        type
        choices
        start
        end
        state
        space {
          id
        }
        scores
        quorum
        scores_total
        plugins
      }
    }
  `);
  const graphqlData = await retry(
    () => request<GraphqlData, { spaceId: string }>(url, query, { spaceId }),
    retryOptions
  );
  return graphqlData.proposals;
};

export const proposeTransactions = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  const supportedModules = await getSupportedModules(params);

  const supportedSpaces = Array.from(
    new Set(Object.values(supportedModules).map((supportedModule) => supportedModule.parsedRules.space))
  );

  const snapshotProposals = (
    await Promise.all(
      supportedSpaces.map(async (space) => getSnapshotProposals(space, params.graphqlEndpoint, params.retryOptions))
    )
  ).flat();
};
