export function getTruffleConfig(truffleContextDir?: string): {
    networks: {};
    plugins: string[];
    mocha: {
        enableTimeouts: boolean;
        before_timeout: number;
    };
    compilers: {
        solc: {
            version: string;
            settings: {
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
            };
        };
    };
    migrations_directory: string;
    contracts_directory: string;
    contracts_build_directory: string;
};
export function getNodeUrl(networkName: any): string;
