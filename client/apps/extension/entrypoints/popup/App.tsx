import { useState, useEffect } from 'react';
import { ExtensionProvider } from '@/components/ExtensionProvider';
import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDojo } from '@/hooks/context/dojo';
import { useEntityQuery } from "@dojoengine/react";
import { Has, getComponentValue } from "@dojoengine/recs";
import { AccountInterface } from 'starknet';

const Home = () => {
    const { account, address, status } = useAccount();
    const { connect, connectors } = useConnect();
    const { disconnect } = useDisconnect();
    const { components } = useDojo();

    // Debug
    useEffect(() => {
        if (components) {
            console.log("Dojo Components:", Object.keys(components));
        }
    }, [components]);

    if (status !== 'connected') {
        return (
            <div className="p-4 flex flex-col gap-4 w-[350px] h-[400px] justify-center items-center bg-background text-foreground">
                <h1 className="text-xl font-bold font-bokor">Eternum Extension</h1>
                <p className="text-muted-foreground text-center text-sm">
                    Connect your controller to access your realms.
                </p>
                {connectors.map((connector) => (
                    <Button key={connector.id} onClick={() => connect({ connector })} className="w-full">
                        Login with {connector.id}
                    </Button>
                ))}
            </div>
        );
    }

    return (
        <div className="p-4 flex flex-col gap-4 w-[400px] h-[500px] overflow-y-auto bg-background text-foreground">
            <div className="flex justify-between items-center bg-secondary p-2 rounded-md">
                <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Connected as</span>
                    <span className="font-mono text-xs truncate w-32" title={address}>{address}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => disconnect()}>Logout</Button>
            </div>

            <RealmsList account={account} />
        </div>
    );
};

const RealmsList = ({ account }: { account: AccountInterface | undefined }) => {
    const { components, systemCalls } = useDojo();
    // Assuming Structure component holds Realm ownership info
    // Adjust if 'Realm' component is the correct one.
    const structures = useEntityQuery([Has(components.Structure)]);
    const [myRealms, setMyRealms] = useState<any[]>([]);

    useEffect(() => {
        if (!account || !structures || !components.Structure) return;

        const myStructures = Array.from(structures).map(entityId => {
            const structure = getComponentValue(components.Structure, entityId);
            return { entityId, ...structure };
        }).filter(s => {
            // Check owner. structure.owner is likely BigInt. account.address is hex string.
            // Convert account address to BigInt
            return s && s.owner === BigInt(account.address);
        });

        // Filter for Realms (category check? or metadata)
        // structure.category is "StructureCategory". Realm is likely a specific category.
        // Assuming all owned structures are valid targets for now.
        setMyRealms(myStructures);
    }, [structures, account, components.Structure]);

    const buildWorkerHut = async (realmId: any) => {
        if (!account) return;
        try {
            console.log("Building hut on", realmId);
            // Directions? [1] (East)
            await systemCalls.create_building({
                signer: account,
                entity_id: realmId,
                directions: [1],
                building_category: 1, // WorkersHut
                use_simple: false
            });
            alert("Build transaction sent!");
        } catch (e) {
            console.error(e);
            alert("Build failed: " + e);
        }
    };

    const deployArmy = async (realmId: any) => {
        if (!account) return;
        try {
            console.log("Deploying army on", realmId);
            await systemCalls.explorer_create({
                signer: account,
                for_structure_id: realmId,
                category: 1, // TroopType.Knight?
                tier: 1, // T1
                amount: 100,
                spawn_direction: 1 // Direction
            });
            alert("Deploy army transaction sent!");
        } catch (e) {
            console.error(e);
            alert("Deploy failed: " + e);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <h2 className="font-bold">My Structures ({myRealms.length})</h2>
            {myRealms.map((realm, i) => (
                <Card key={i} className="p-3 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <span className="font-mono text-xs">ID: {realm.entity_id}</span>
                        <span className="text-xs">X:{realm.base?.coord_x} Y:{realm.base?.coord_y}</span>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" onClick={() => buildWorkerHut(realm.entity_id)}>Build Hut</Button>
                        <Button size="sm" variant="secondary" onClick={() => deployArmy(realm.entity_id)}>Deploy Army</Button>
                    </div>
                </Card>
            ))}
            {myRealms.length === 0 && <p className="text-sm text-muted-foreground">No structures found.</p>}
        </div>
    );
}

export default function App() {
    return (
        <ExtensionProvider>
            <Home />
        </ExtensionProvider>
    );
}
