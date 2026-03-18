import { useState } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { useOFTWiring } from '@/hooks/useOFTWiring';
import { EvmWalletButton } from '@/components/EvmWalletButton';
import { StarknetWalletButton } from '@/components/StarknetWalletButton';
import { TxStatus } from '@/components/TxStatus';
import { CONTRACTS, ARB_SEPOLIA, BASE_SEPOLIA } from '@/config/chains';
import { formatUnits } from 'ethers';
import type { TxState, AdapterState, PeerState } from '@/types';

export function OFTWiring(): JSX.Element {
  const evm = useEvmWallet();
  const stark = useStarknetWallet();
  const wiring = useOFTWiring(evm.signer);

  const [adapterState, setAdapterState] = useState<AdapterState | null>(null);
  const [peerState, setPeerState] = useState<PeerState | null>(null);
  const [loadingState, setLoadingState] = useState(false);

  // form state
  const [contractAddr, setContractAddr] = useState(CONTRACTS.adapter);
  const [peerEid, setPeerEid] = useState(String(CONTRACTS.peerEid));
  const [peerAddr, setPeerAddr] = useState(CONTRACTS.peer);
  const [gasLimit, setGasLimit] = useState('80000');
  const [rlLimit, setRlLimit] = useState('1000000000000000000000000');
  const [rlWindow, setRlWindow] = useState('3600');
  const [delegate, setDelegate] = useState('');

  const [tx, setTx] = useState<TxState>({ status: 'idle' });

  async function loadState(): Promise<void> {
    setLoadingState(true);
    try {
      const [a, p] = await Promise.all([
        wiring.readAdapterState(CONTRACTS.adapter, CONTRACTS.peerEid, ARB_SEPOLIA.rpc),
        wiring.readPeerState(CONTRACTS.peer, CONTRACTS.adapterEid, BASE_SEPOLIA.rpc),
      ]);
      setAdapterState(a);
      setPeerState(p);
    } catch (err) {
      console.error(err);
    }
    setLoadingState(false);
  }

  async function handleSetPeer(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await wiring.setEvmPeer(contractAddr, Number(peerEid), peerAddr);
    setTx(result);
  }

  async function handleSetOptions(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await wiring.setEvmEnforcedOptions(contractAddr, Number(peerEid), BigInt(gasLimit));
    setTx(result);
  }

  async function handleSetRateLimit(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await wiring.setRateLimit(CONTRACTS.adapter, Number(peerEid), BigInt(rlLimit), Number(rlWindow));
    setTx(result);
  }

  async function handleSetDelegate(): Promise<void> {
    setTx({ status: 'pending' });
    const result = await wiring.setDelegate(contractAddr, delegate);
    setTx(result);
  }

  return (
    <div>
      <div className="topbar">
        <h2>OFT Wiring</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <EvmWalletButton
            address={evm.address}
            chainId={evm.chainId}
            chainName={ARB_SEPOLIA.name}
            onConnect={evm.connect}
            onSwitchNetwork={() => evm.switchNetwork(ARB_SEPOLIA.id)}
            targetChainId={ARB_SEPOLIA.id}
          />
          <StarknetWalletButton address={stark.address} onConnect={stark.connect} />
        </div>
      </div>

      {/* Current State */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Current On-Chain State</h3>
          <button className="btn" onClick={loadState} disabled={loadingState}>
            {loadingState ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {adapterState && (
          <div className="state-grid">
            <div className="state-block">
              <div className="label">Adapter ({ARB_SEPOLIA.name})</div>
              <Row label="Owner" value={adapterState.owner} />
              <Row label="Token" value={adapterState.token} />
              <Row label={`Peer (EID ${CONTRACTS.peerEid})`} value={adapterState.peer} />
              <Row label="Enforced Options (SEND)" value={adapterState.enforcedOptionsSend || '(none)'} />
              <Row label="Rate Limit" value={`${formatUnits(adapterState.rateLimit.limit, 18)} / ${adapterState.rateLimit.window}s`} />
              <Row label="In Flight" value={`${formatUnits(adapterState.amountInFlight, 18)} (can send ${formatUnits(adapterState.amountCanBeSent, 18)})`} />
            </div>
            {peerState && (
              <div className="state-block">
                <div className="label">Peer ({BASE_SEPOLIA.name})</div>
                <Row label="Owner" value={peerState.owner} />
                <Row label={`Peer (EID ${CONTRACTS.adapterEid})`} value={peerState.peer} />
                <Row label="Enforced Options (SEND)" value={peerState.enforcedOptionsSend || '(none)'} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Configure */}
      <section className="card">
        <h3>Configure</h3>
        <div className="form-grid">
          <Field label="Contract address" value={contractAddr} onChange={setContractAddr} />
          <Field label="Peer EID" value={peerEid} onChange={setPeerEid} />
        </div>

        <div className="action-row">
          <div>
            <div className="label">Set Peer</div>
            <Field label="Peer address" value={peerAddr} onChange={setPeerAddr} />
            <button className="btn" onClick={handleSetPeer} disabled={!evm.isConnected}>Set Peer</button>
          </div>

          <div>
            <div className="label">Set Enforced Options</div>
            <Field label="Gas limit" value={gasLimit} onChange={setGasLimit} />
            <button className="btn" onClick={handleSetOptions} disabled={!evm.isConnected}>Set Options</button>
          </div>

          <div>
            <div className="label">Set Rate Limit (Adapter only)</div>
            <Field label="Limit (raw units)" value={rlLimit} onChange={setRlLimit} />
            <Field label="Window (seconds)" value={rlWindow} onChange={setRlWindow} />
            <button className="btn" onClick={handleSetRateLimit} disabled={!evm.isConnected}>Set Rate Limit</button>
          </div>

          <div>
            <div className="label">Set Delegate</div>
            <Field label="Delegate address" value={delegate} onChange={setDelegate} />
            <button className="btn" onClick={handleSetDelegate} disabled={!evm.isConnected}>Set Delegate</button>
          </div>
        </div>

        <TxStatus state={tx} />
      </section>

      {/* Cairo scaffold */}
      <section className="card card-wip">
        <h3>EVM ↔ Cairo (Starknet) — WIP</h3>
        <p style={{ color: '#888', fontSize: 13 }}>
          Cairo OFT contracts not yet deployed. Connect ArgentX/Braavos and wire once contracts are ready.
          See <code>src/hooks/useOFTWiring.ts → setCairoPeer</code> and{' '}
          <code>src/hooks/useStarknetWallet.ts</code> for scaffolded implementations.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="state-row">
      <span className="state-key">{label}</span>
      <span className="state-val">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="label">{label}</div>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
