import { ReactNode, useEffect, useMemo, useState } from 'react';
import { StarknetConfig, jsonRpcProvider } from '@starknet-react/core';
import ControllerConnector from "@cartridge/connector/controller";
import { useExtensionStore } from '@/hooks/store';
import { buildPolicies } from '@/utils/policies';
import { patchManifestWithFactory } from '@/utils/manifest-patcher';
import baseManifest from '@/assets/manifest.json';
import { Chain } from '@starknet-react/chains';
import { setup } from "@bibliothecadao/dojo";
import { createDojoConfig } from "@dojoengine/core";
import { DojoProvider } from '@/hooks/context/dojo';

export const ExtensionProvider = ({ children }: { children: ReactNode }) => {
    const { config, loadConfig } = useExtensionStore();
    const [patchedManifest, setPatchedManifest] = useState<any>(null);
    const [setupResult, setSetupResult] = useState<any>(null);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    useEffect(() => {
        if (config) {
            const patched = patchManifestWithFactory(
                baseManifest,
                config.worldAddress,
                config.contractsBySelector
            );
            setPatchedManifest(patched);
        }
    }, [config]);

    const chains = useMemo(() => {
        if (!config) return [];

        let rpcUrl = config.toriiBaseUrl.replace('/torii', '/katana');
        if (config.chain === 'local') {
             rpcUrl = "http://localhost:5050";
        }

        return [{
            id: BigInt(5914666136088024221689784n),
            network: config.chain,
            name: config.chain,
            nativeCurrency: {
                address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
                name: "Ether",
                symbol: "ETH",
                decimals: 18,
            },
            rpcUrls: {
                default: { http: [rpcUrl] },
                public: { http: [rpcUrl] },
            },
            testnet: true
        } as unknown as Chain];
    }, [config]);

    useEffect(() => {
        const initDojo = async () => {
            if (config && patchedManifest && chains.length > 0) {
                 const rpcUrl = chains[0].rpcUrls.default.http[0];
                 const dojoConf = createDojoConfig({
                     manifest: patchedManifest,
                     rpcUrl,
                     toriiUrl: config.toriiBaseUrl,
                     masterAddress: "0x0",
                     masterPrivateKey: "0x0",
                     accountClassHash: "0x0",
                     feeTokenAddress: "0x0"
                 });

                 try {
                     const res = await setup(dojoConf, { vrfProviderAddress: "0x0", useBurner: false });
                     setSetupResult(res);
                 } catch (e) {
                     console.error("Dojo setup failed", e);
                 }
            }
        }
        initDojo();
    }, [config, patchedManifest, chains]);

    const provider = jsonRpcProvider({
        rpc: (chain) => {
             return { nodeUrl: chain.rpcUrls.default.http[0] };
        }
    });

    const connectors = useMemo(() => {
        if (!config || !patchedManifest || chains.length === 0) return [];

        const rpcUrl = chains[0].rpcUrls.default.http[0];

        const controller = new ControllerConnector({
            chains: [{ rpcUrl }],
            policies: buildPolicies(patchedManifest, config.chain),
            namespace: "s1_eternum",
            slot: config.name,
        });
        return [controller];
    }, [config, patchedManifest, chains]);

    if (!config) {
        return (
            <div className="flex items-center justify-center h-full p-4 text-center">
                <p>Please open a generic Realms World game tab (e.g. sandbox.blitz.realms.world) to load configuration.</p>
            </div>
        );
    }

    if (!setupResult) return <div className="p-4">Initializing Game Connection...</div>;

    return (
        <StarknetConfig chains={chains} provider={provider} connectors={connectors as any} autoConnect>
            <DojoProvider value={setupResult}>
                {children}
            </DojoProvider>
        </StarknetConfig>
    );
};
