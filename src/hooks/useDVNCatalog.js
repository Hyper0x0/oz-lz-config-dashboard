import { useState, useEffect, useRef } from 'react';
/**
 * Endpoint: https://metadata.layerzero-api.com/v1/metadata/dvns
 *
 * Actual response shape (keyed by chain name, NOT by DVN name):
 *   {
 *     "arbitrum": {
 *       "dvns": {
 *         "0xDeAd...": { "canonicalName": "LayerZero Labs", "version": 2, "id": "layerzero-labs" },
 *         "0xBeef...": { "canonicalName": "Nethermind", "version": 2 }
 *       }
 *     },
 *     "ethereum": { "dvns": { ... } }
 *   }
 */
const DVN_API = 'https://metadata.layerzero-api.com/v1/metadata/dvns';
/**
 * Logo URLs keyed by the canonical DVN `id` from the LZ metadata API.
 * All use GitHub org avatars as a stable, cached CDN source.
 * Unknown providers fall back to initials avatar.
 */
const DVN_ICONS = {
    'layerzero-labs': 'https://github.com/LayerZero-Labs.png?size=32',
    'google-cloud': 'https://github.com/google.png?size=32',
    'nethermind': 'https://github.com/NethermindEth.png?size=32',
    'polyhedra-network': 'https://github.com/Polyhedra-Network.png?size=32',
    'horizen-labs': 'https://github.com/HorizenLabs.png?size=32',
    'bitgo': 'https://github.com/BitGo.png?size=32',
    'bware-labs': 'https://github.com/bwarelabs.png?size=32',
    'axelar': 'https://github.com/axelarnetwork.png?size=32',
    'stargate': 'https://github.com/stargate-protocol.png?size=32',
    'ccip': 'https://github.com/smartcontractkit.png?size=32',
    'mysten-labs': 'https://github.com/MystenLabs.png?size=32',
    'lagrange-labs': 'https://github.com/Lagrange-Labs.png?size=32',
    'deutsche-telekom': 'https://github.com/telekom.png?size=32',
    'ubisoft': 'https://github.com/ubisoft.png?size=32',
    'switchboard': 'https://github.com/switchboard-xyz.png?size=32',
    'frax': 'https://github.com/FraxFinance.png?size=32',
    'gitcoin': 'https://github.com/gitcoinco.png?size=32',
    'curve': 'https://github.com/curvefi.png?size=32',
    'paxos': 'https://github.com/paxosglobal.png?size=32',
    'p2p': 'https://github.com/p2p-org.png?size=32',
    'stablelab': 'https://github.com/StableLab.png?size=32',
    'superform': 'https://github.com/superform-xyz.png?size=32',
    'predicate': 'https://github.com/predicatelabs.png?size=32',
    'omni-network': 'https://github.com/omni-network.png?size=32',
    'restake': 'https://github.com/restake.png?size=32',
    'nansen': 'https://github.com/nansen-ai.png?size=32',
    'bcw': 'https://github.com/bcwgroup.png?size=32',
    'luganodes': 'https://github.com/Luganodes.png?size=32',
    'nodes-guru': 'https://github.com/nodesguru.png?size=32',
    'p-ops-team': 'https://github.com/P-OPSTeam.png?size=32',
    'zeeve': 'https://github.com/zeeve-inc.png?size=32',
    'nodit': 'https://github.com/nodit-io.png?size=32',
};
// Colour palette for avatar initials — deterministic by provider name
const AVATAR_COLORS = {
    'LayerZero Labs': '#5865f2',
    'Google Cloud': '#4285f4',
    'Nethermind': '#b958f5',
    'Polyhedra': '#00c2ff',
    'Horizen Labs': '#1cd8d2',
    'BitGo': '#f5a623',
    'Bware Labs': '#e86c2c',
    'Animoca Brands': '#ff4e8a',
    'BlockPI': '#2db07d',
    'Stargate': '#6979f8',
};
function colorFor(name) {
    // Exact match first, then prefix match for variants like "Horizen"
    if (name in AVATAR_COLORS)
        return AVATAR_COLORS[name];
    const key = Object.keys(AVATAR_COLORS).find((k) => name.startsWith(k.split(' ')[0]));
    return key ? AVATAR_COLORS[key] : '#888';
}
// ── Module-level cache ────────────────────────────────────────────────────────
let _cache = null;
let _pending = null;
async function fetchRaw() {
    if (_cache)
        return _cache;
    if (_pending)
        return _pending;
    _pending = fetch(DVN_API)
        .then((r) => {
        if (!r.ok)
            throw new Error(`DVN API ${r.status}`);
        return r.json();
    })
        .then((data) => {
        _cache = data;
        _pending = null;
        return data;
    })
        .catch((err) => {
        _pending = null;
        throw err;
    });
    return _pending;
}
function parseDVNsForChain(raw, chainKey) {
    const chainData = raw[chainKey];
    if (!chainData?.dvns)
        return [];
    const result = [];
    for (const [address, meta] of Object.entries(chainData.dvns)) {
        if (!meta?.canonicalName || meta.deprecated)
            continue;
        // Skip LZ Read DVNs — they are for the Read protocol, not OFT messaging
        if (meta.lzReadCompatible)
            continue;
        result.push({
            name: meta.canonicalName,
            address,
            color: colorFor(meta.canonicalName),
            icon: meta.id ? DVN_ICONS[meta.id] : undefined,
        });
    }
    // Sort: known providers first, then alpha
    result.sort((a, b) => {
        const aKnown = a.color !== '#888' ? 0 : 1;
        const bKnown = b.color !== '#888' ? 0 : 1;
        return aKnown - bKnown || a.name.localeCompare(b.name);
    });
    return result;
}
export function useDVNCatalog(chainKey) {
    const [dvns, setDvns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const rawRef = useRef(null);
    useEffect(() => {
        if (!chainKey)
            return;
        setLoading(true);
        setError(null);
        fetchRaw()
            .then((raw) => {
            rawRef.current = raw;
            setDvns(parseDVNsForChain(raw, chainKey));
            setLoading(false);
        })
            .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
        });
    }, [chainKey]);
    function resolveName(address, forChainKey) {
        const raw = rawRef.current;
        if (!raw)
            return null;
        const key = forChainKey ?? chainKey;
        return raw[key]?.dvns?.[address]?.canonicalName ?? raw[key]?.dvns?.[address.toLowerCase()]?.canonicalName ?? null;
    }
    return { dvns, loading, error, resolveName };
}
