export = browserSafe;
export = browserSafe;
declare const browserSafe: {
    IDENTIFIER_BLACKLIST: {
        SOME_IDENTIFIER: string[];
    };
    IDENTIFIER_NON_18_PRECISION: {
        USDBTC: number;
        "STABLESPREAD/USDC": number;
        "STABLESPREAD/BTC": number;
        "ELASTIC_STABLESPREAD/USDC": number;
        BCHNBTC: number;
    };
    getPrecisionForIdentifier: (identifier: any) => any;
    getVotingRoles: (account: string, voting: any, designatedVoting?: any) => {
        votingContract: any;
        votingAccount: any;
        signingAddress: string;
    };
    getLatestEvent: (eventName: any, request: any, roundId: any, account: any, votingContract: any) => Promise<any>;
    constructCommitment: (request: any, roundId: string, web3: any, price: any, signingAccount: string, votingAccount: string, decimals?: string) => Promise<{
        identifier: any;
        time: any;
        hash: any;
        encryptedVote: string;
        price: string;
        salt: any;
    }>;
    constructReveal: (request: any, roundId: string, web3: any, signingAccount: string, votingContract: any, votingAccount: string) => Promise<{
        identifier: any;
        time: any;
        price: any;
        salt: any;
    }>;
    batchCommitVotes: (newCommitments: any, votingContract: any, account: any) => Promise<{
        successes: any[];
        batches: number;
    }>;
    batchRevealVotes: (newReveals: any, votingContract: any, account: any) => Promise<{
        successes: any[];
        batches: number;
    }>;
    batchRetrieveRewards: (requests: any, roundId: any, votingContract: any, votingAccount: any, signingAccount: any) => Promise<{
        successes: any[];
        batches: number;
    }>;
    averageBlockTimeSeconds: () => Promise<number>;
    getFromBlock: typeof import("./src/TimeUtils").getFromBlock;
    didContractThrow: typeof import("./src/SolidityTestUtils").didContractThrow;
    mineTransactionsAtTime: typeof import("./src/SolidityTestUtils").mineTransactionsAtTime;
    advanceBlockAndSetTime: typeof import("./src/SolidityTestUtils").advanceBlockAndSetTime;
    takeSnapshot: typeof import("./src/SolidityTestUtils").takeSnapshot;
    revertToSnapshot: typeof import("./src/SolidityTestUtils").revertToSnapshot;
    stopMining: typeof import("./src/SolidityTestUtils").stopMining;
    startMining: typeof import("./src/SolidityTestUtils").startMining;
    SolcoverConfig: {
        providerOptions: {
            network_id: number;
        };
        skipFiles: string[];
    };
    getRandomSignedInt: typeof import("./src/Random").getRandomSignedInt;
    getRandomUnsignedInt: typeof import("./src/Random").getRandomUnsignedInt;
    PublicNetworks: {
        1: {
            name: string;
            ethFaucet: any;
            etherscan: string;
            daiAddress: string;
            wethAddress: string;
        };
        3: {
            name: string;
            ethFaucet: string;
            etherscan: string;
            daiAddress: string;
            wethAddress: string;
        };
        4: {
            name: string;
            ethFaucet: string;
            etherscan: string;
            daiAddress: string;
            wethAddress: string;
        };
        42: {
            name: string;
            ethFaucet: string;
            etherscan: string;
            daiAddress: string;
            wethAddress: string;
        };
    };
    createObjectFromDefaultProps: (overrideProps?: any, defaultProps: any) => {};
    formatDateShort: (timestampInSeconds: any) => string;
    formatDate: (timestampInSeconds: any, web3: any) => string;
    formatHours: (seconds: any, decimals?: number) => string;
    formatWei: (num: any, web3: any) => any;
    formatWithMaxDecimals: (num: any, decimalPlaces: any, minPrecision: any, roundUp: any, showSign: any) => string;
    createFormatFunction: (web3: any, numDisplayedDecimals: any, minDisplayedPrecision: any, showSign?: boolean, decimals?: number) => (valInWei: any) => string;
    createEtherscanLinkFromtx: typeof import("./src/FormattingUtils").createEtherscanLinkFromtx;
    createShortHexString: typeof import("./src/FormattingUtils").createShortHexString;
    createEtherscanLinkMarkdown: typeof import("./src/FormattingUtils").createEtherscanLinkMarkdown;
    addSign: typeof import("./src/FormattingUtils").addSign;
    formatFixed: typeof import("@ethersproject/bignumber/lib/fixednumber").formatFixed;
    parseFixed: typeof import("@ethersproject/bignumber/lib/fixednumber").parseFixed;
    ConvertDecimals: (fromDecimals: any, toDecimals: any, web3: any) => (amount: any) => any;
    RegistryRolesEnum: {
        OWNER: string;
        CONTRACT_CREATOR: string;
    };
    VotePhasesEnum: {
        COMMIT: string;
        REVEAL: string;
    };
    LiquidationStatesEnum: {
        UNINITIALIZED: string;
        PRE_DISPUTE: string;
        PENDING_DISPUTE: string;
        DISPUTE_SUCCEEDED: string;
        DISPUTE_FAILED: string;
    };
    PostWithdrawLiquidationRewardsStatusTranslations: {
        "0": string;
        "3": string;
    };
    PositionStatesEnum: {
        OPEN: string;
        EXPIRED_PRICE_REQUESTED: string;
        EXPIRED_PRICE_RECEIVED: string;
    };
    PriceRequestStatusEnum: {
        NOT_REQUESTED: string;
        ACTIVE: string;
        RESOLVED: string;
        FUTURE: string;
    };
    OptimisticOracleRequestStatesEnum: {
        INVALID: string;
        REQUESTED: string;
        PROPOSED: string;
        EXPIRED: string;
        DISPUTED: string;
        RESOLVED: string;
        SETTLED: string;
    };
    computeTopicHash: typeof import("./src/EncryptionHelper").computeTopicHash;
    computeVoteHash: typeof import("./src/EncryptionHelper").computeVoteHash;
    computeVoteHashAncillary: typeof import("./src/EncryptionHelper").computeVoteHashAncillary;
    getKeyGenMessage: typeof import("./src/EncryptionHelper").getKeyGenMessage;
    computeCollateralizationRatio: typeof import("./src/EmpUtils").computeCollateralizationRatio;
    encryptMessage: typeof import("./src/Crypto").encryptMessage;
    addressFromPublicKey: typeof import("./src/Crypto").addressFromPublicKey;
    decryptMessage: typeof import("./src/Crypto").decryptMessage;
    recoverPublicKey: typeof import("./src/Crypto").recoverPublicKey;
    deriveKeyPairFromSignatureTruffle: typeof import("./src/Crypto").deriveKeyPairFromSignatureTruffle;
    deriveKeyPairFromSignatureMetamask: typeof import("./src/Crypto").deriveKeyPairFromSignatureMetamask;
    getMessageSignatureTruffle: typeof import("./src/Crypto").getMessageSignatureTruffle;
    getMessageSignatureMetamask: typeof import("./src/Crypto").getMessageSignatureMetamask;
    signMessage: typeof import("./src/Crypto").signMessage;
    revertWrapper: (result: any) => any;
    BATCH_MAX_COMMITS: number;
    BATCH_MAX_REVEALS: number;
    BATCH_MAX_RETRIEVALS: number;
    MAX_UINT_VAL: string;
    MAX_SAFE_JS_INT: number;
    ZERO_ADDRESS: string;
    interfaceName: {
        FinancialContractsAdmin: string;
        Oracle: string;
        Registry: string;
        Store: string;
        IdentifierWhitelist: string;
        CollateralWhitelist: string;
        FundingRateStore: string;
        OptimisticOracle: string;
    };
    UMA_FIRST_EMP_BLOCK: number;
    decodeTransaction: typeof import("./src/AdminUtils").decodeTransaction;
    isAdminRequest: typeof import("./src/AdminUtils").isAdminRequest;
    getAdminRequestId: typeof import("./src/AdminUtils").getAdminRequestId;
    translateAdminVote: (voteValue: any) => "No Vote" | "YES" | "NO" | "INVALID ADMIN VOTE";
    getAllContracts: typeof import("./src/AbiUtils").getAllContracts;
    getAbiDecoder: typeof import("./src/AbiUtils").getAbiDecoder;
};
