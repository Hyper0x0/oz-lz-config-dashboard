import { useState } from 'react';
import { useEvmWallet } from '@/hooks/useEvmWallet';
import { useTimelockOps } from '@/hooks/useTimelockOps';
import { EvmWalletButton } from '@/components/EvmWalletButton';
import { TxStatus } from '@/components/TxStatus';
import { CONTRACTS, ARB_SEPOLIA } from '@/config/chains';
import { VaultState } from '@/types';
import {
  encodeRegisterVault,
  encodeSetVaultState,
  encodeSetVaultOft,
  encodeSetPerformanceFeeBps,
  encodeSetMaintenanceFeeBps,
  encodeSetFeeRecipient,
} from '@/utils/abiEncode';
import { hashOperation as localHashOp, formatDelay, operationStateLabel, randomSalt, formatCountdown } from '@/utils/timelock';
import type { TxState, OperationState } from '@/types';

type OpType =
  | 'registerVault'
  | 'setVaultState'
  | 'setVaultOft'
  | 'setPerformanceFeeBps'
  | 'setMaintenanceFeeBps'
  | 'setFeeRecipient';

export function Timelock(): JSX.Element {
  const evm = useEvmWallet();
  const ops = useTimelockOps(evm.signer);

  const [gatewayAddr, setGatewayAddr] = useState(CONTRACTS.adminGateway);
  const [minDelay, setMinDelay] = useState<string>('');
  const [opType, setOpType] = useState<OpType>('registerVault');

  // generic operation params
  const [vaultId, setVaultId] = useState('1');
  const [addr1, setAddr1] = useState('');
  const [addr2, setAddr2] = useState('');
  const [addr3, setAddr3] = useState('');
  const [addr4, setAddr4] = useState('');
  const [bps, setBps] = useState('');
  const [vaultState, setVaultState] = useState<string>('1');
  const [delay, setDelay] = useState('172800');
  const [salt, setSalt] = useState(randomSalt());
  const [predecessor, setPredecessor] = useState('0x0000000000000000000000000000000000000000000000000000000000000000');
  const [calldata, setCalldata] = useState('');

  // check op state
  const [lookupHash, setLookupHash] = useState('');
  const [opState, setOpState] = useState<OperationState | null>(null);
  const [opEta, setOpEta] = useState<string | null>(null);

  const [tx, setTx] = useState<TxState>({ status: 'idle' });

  async function loadMinDelay(): Promise<void> {
    if (!gatewayAddr || gatewayAddr === '0x') return;
    const d = await ops.getMinDelay(gatewayAddr);
    setMinDelay(formatDelay(Number(d)));
  }

  function buildCalldata(): string {
    try {
      switch (opType) {
        case 'registerVault':
          return encodeRegisterVault(addr1, addr2, addr3, addr4);
        case 'setVaultState':
          return encodeSetVaultState(BigInt(vaultId), Number(vaultState) as VaultState);
        case 'setVaultOft':
          return encodeSetVaultOft(BigInt(vaultId), addr1);
        case 'setPerformanceFeeBps':
          return encodeSetPerformanceFeeBps(BigInt(vaultId), BigInt(bps));
        case 'setMaintenanceFeeBps':
          return encodeSetMaintenanceFeeBps(BigInt(vaultId), BigInt(bps));
        case 'setFeeRecipient':
          return encodeSetFeeRecipient(BigInt(vaultId), addr1);
        default:
          return '';
      }
    } catch (err) {
      return `Error: ${String(err)}`;
    }
  }

  function previewCalldata(): void {
    setCalldata(buildCalldata());
  }

  async function handleSchedule(): Promise<void> {
    if (!gatewayAddr) return;
    setTx({ status: 'pending' });
    const data = buildCalldata();
    const result = await ops.schedule(gatewayAddr, 0n, data, predecessor, salt, BigInt(delay));
    setTx(result);
  }

  async function handleLookup(): Promise<void> {
    if (!gatewayAddr || !lookupHash) return;
    const state = await ops.getOperationState(gatewayAddr, lookupHash);
    setOpState(state);
    if (state === 'Waiting') {
      const ts = await ops.getTimestamp(gatewayAddr, lookupHash);
      setOpEta(formatCountdown(Number(ts)));
    } else {
      setOpEta(null);
    }
  }

  async function handleExecute(): Promise<void> {
    if (!gatewayAddr) return;
    setTx({ status: 'pending' });
    const data = buildCalldata();
    const result = await ops.execute(gatewayAddr, 0n, data, predecessor, salt);
    setTx(result);
  }

  return (
    <div>
      <div className="topbar">
        <h2>Timelock — AdminGateway</h2>
        <EvmWalletButton
          address={evm.address}
          chainId={evm.chainId}
          chainName={ARB_SEPOLIA.name}
          onConnect={evm.connect}
          onSwitchNetwork={() => evm.switchNetwork(ARB_SEPOLIA.id)}
          targetChainId={ARB_SEPOLIA.id}
        />
      </div>

      {/* Gateway config */}
      <section className="card">
        <h3>AdminGateway</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div className="label">AdminGateway address</div>
            <input className="input" value={gatewayAddr} onChange={(e) => setGatewayAddr(e.target.value)} />
          </div>
          <button className="btn" onClick={loadMinDelay}>Load Min Delay</button>
        </div>
        {minDelay && <div style={{ marginTop: 8, color: '#aaa' }}>Min delay: <strong>{minDelay}</strong></div>}
      </section>

      {/* Schedule */}
      <section className="card">
        <h3>Schedule Operation</h3>

        <div style={{ marginBottom: 12 }}>
          <div className="label">Operation type</div>
          <select className="input" value={opType} onChange={(e) => setOpType(e.target.value as OpType)}>
            <option value="registerVault">registerVault</option>
            <option value="setVaultState">setVaultState</option>
            <option value="setVaultOft">setVaultOft</option>
            <option value="setPerformanceFeeBps">setPerformanceFeeBps</option>
            <option value="setMaintenanceFeeBps">setMaintenanceFeeBps</option>
            <option value="setFeeRecipient">setFeeRecipient</option>
          </select>
        </div>

        <OpFields
          opType={opType}
          vaultId={vaultId} setVaultId={setVaultId}
          addr1={addr1} setAddr1={setAddr1}
          addr2={addr2} setAddr2={setAddr2}
          addr3={addr3} setAddr3={setAddr3}
          addr4={addr4} setAddr4={setAddr4}
          bps={bps} setBps={setBps}
          vaultState={vaultState} setVaultState={setVaultState}
        />

        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div className="label">Delay (seconds)</div>
            <input className="input" value={delay} onChange={(e) => setDelay(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">Salt</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={salt} onChange={(e) => setSalt(e.target.value)} style={{ flex: 1 }} />
              <button className="btn" onClick={() => setSalt(randomSalt())}>Rand</button>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">Predecessor</div>
            <input className="input" value={predecessor} onChange={(e) => setPredecessor(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={previewCalldata}>Preview Calldata</button>
          <button className="btn btn-primary" onClick={handleSchedule} disabled={!evm.isConnected}>
            Schedule
          </button>
        </div>

        {calldata && (
          <div className="state-block" style={{ marginTop: 10 }}>
            <div className="label">Encoded calldata</div>
            <div style={{ wordBreak: 'break-all', fontSize: 12, color: '#aaa' }}>{calldata}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#777' }}>
              Op hash (local): {localHashOp(gatewayAddr, 0n, calldata, predecessor, salt)}
            </div>
          </div>
        )}

        <TxStatus state={tx} />
      </section>

      {/* Lookup */}
      <section className="card">
        <h3>Check Operation State</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div className="label">Operation hash (bytes32)</div>
            <input className="input" value={lookupHash} onChange={(e) => setLookupHash(e.target.value)} />
          </div>
          <button className="btn" onClick={handleLookup} disabled={!gatewayAddr}>Lookup</button>
        </div>
        {opState && (
          <div style={{ marginTop: 10, color: opState === 'Ready' ? '#7fff7f' : '#aaa' }}>
            State: <strong>{opState}</strong>
            {opEta && <span style={{ marginLeft: 8, color: '#888' }}>{opEta}</span>}
          </div>
        )}
      </section>

      {/* Execute */}
      <section className="card">
        <h3>Execute Operation</h3>
        <p style={{ color: '#888', fontSize: 13 }}>
          Fill in the same operation type + params used to schedule, then click Execute.
          The calldata must match exactly.
        </p>
        <button className="btn btn-primary" onClick={handleExecute} disabled={!evm.isConnected}>
          Execute
        </button>
        <TxStatus state={tx} />
      </section>
    </div>
  );
}

// Dynamic field rendering based on operation type
function OpFields({
  opType, vaultId, setVaultId,
  addr1, setAddr1, addr2, setAddr2, addr3, setAddr3, addr4, setAddr4,
  bps, setBps, vaultState, setVaultState,
}: {
  opType: OpType;
  vaultId: string; setVaultId: (v: string) => void;
  addr1: string; setAddr1: (v: string) => void;
  addr2: string; setAddr2: (v: string) => void;
  addr3: string; setAddr3: (v: string) => void;
  addr4: string; setAddr4: (v: string) => void;
  bps: string; setBps: (v: string) => void;
  vaultState: string; setVaultState: (v: string) => void;
}): JSX.Element {
  const F = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div style={{ marginBottom: 8 }}>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  );

  switch (opType) {
    case 'registerVault':
      return (
        <>
          <F label="SyVault address" value={addr1} onChange={setAddr1} />
          <F label="LiquidityPool address" value={addr2} onChange={setAddr2} />
          <F label="SyShare address" value={addr3} onChange={setAddr3} />
          <F label="SyOFT address" value={addr4} onChange={setAddr4} />
        </>
      );
    case 'setVaultState':
      return (
        <>
          <F label="Vault ID" value={vaultId} onChange={setVaultId} />
          <div style={{ marginBottom: 8 }}>
            <div className="label">New state</div>
            <select className="input" value={vaultState} onChange={(e) => setVaultState(e.target.value)}>
              <option value="0">0 — Pending</option>
              <option value="1">1 — Active</option>
              <option value="2">2 — Deprecated</option>
              <option value="3">3 — Closed</option>
            </select>
          </div>
        </>
      );
    case 'setVaultOft':
      return (
        <>
          <F label="Vault ID" value={vaultId} onChange={setVaultId} />
          <F label="SyOFT address" value={addr1} onChange={setAddr1} />
        </>
      );
    case 'setPerformanceFeeBps':
    case 'setMaintenanceFeeBps':
      return (
        <>
          <F label="Vault ID" value={vaultId} onChange={setVaultId} />
          <F label="Fee BPS (e.g. 1000 = 10%)" value={bps} onChange={setBps} />
        </>
      );
    case 'setFeeRecipient':
      return (
        <>
          <F label="Vault ID" value={vaultId} onChange={setVaultId} />
          <F label="Fee recipient address" value={addr1} onChange={setAddr1} />
        </>
      );
    default:
      return <></>;
  }
}
