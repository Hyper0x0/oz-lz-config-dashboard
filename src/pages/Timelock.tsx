import { useState, useMemo, useEffect } from 'react';
import { JsonRpcProvider, Interface } from 'ethers';
import TimelockControllerABI from '@/abis/TimelockController.json';
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
import { hashOperation as localHashOp, formatDelay, randomSalt, formatCountdown } from '@/utils/timelock';
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

  const [timelockAddr, setTimelockAddr] = useState(CONTRACTS.adminGateway ?? '');
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
  // Calldata computed reactively — always reflects current form state
  const { calldata, calldataError } = useMemo(() => {
    try {
      let data = '';
      switch (opType) {
        case 'registerVault':    data = encodeRegisterVault(addr1, addr2, addr3, addr4); break;
        case 'setVaultState':    data = encodeSetVaultState(BigInt(vaultId || '0'), Number(vaultState) as VaultState); break;
        case 'setVaultOft':      data = encodeSetVaultOft(BigInt(vaultId || '0'), addr1); break;
        case 'setPerformanceFeeBps': data = encodeSetPerformanceFeeBps(BigInt(vaultId || '0'), BigInt(bps || '0')); break;
        case 'setMaintenanceFeeBps': data = encodeSetMaintenanceFeeBps(BigInt(vaultId || '0'), BigInt(bps || '0')); break;
        case 'setFeeRecipient':  data = encodeSetFeeRecipient(BigInt(vaultId || '0'), addr1); break;
      }
      return { calldata: data, calldataError: null };
    } catch (e) {
      return { calldata: null, calldataError: e instanceof Error ? e.message : String(e) };
    }
  }, [opType, vaultId, addr1, addr2, addr3, addr4, bps, vaultState]);

  const [lastCalldata, setLastCalldata] = useState<string | null>(null);
  useEffect(() => { if (calldata) setLastCalldata(calldata); }, [calldata]);
  const execCalldata = calldata ?? lastCalldata;

  const freshOpHash = execCalldata && timelockAddr
    ? localHashOp(timelockAddr, 0n, execCalldata, predecessor, salt)
    : null;
  const [lastOpHash, setLastOpHash] = useState<string | null>(null);
  useEffect(() => { if (freshOpHash) setLastOpHash(freshOpHash); }, [freshOpHash]);
  const opHash = freshOpHash ?? lastOpHash;

  // check op state
  const [lookupHash, setLookupHash] = useState('');
  const [opState, setOpState] = useState<OperationState | null>(null);
  const [opEta, setOpEta] = useState<string | null>(null);
  const [lookupDebug, setLookupDebug] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // derive hash + exec params from tx
  const [deriveTxHash, setDeriveTxHash] = useState('');
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  // params extracted from CallScheduled — used for Execute directly
  const [derivedTarget, setDerivedTarget] = useState<string | null>(null);
  const [derivedCalldata, setDerivedCalldata] = useState<string | null>(null);
  const [derivedPredecessor, setDerivedPredecessor] = useState<string | null>(null);
  const [derivedSalt, setDerivedSalt] = useState<string | null>(null);

  const [scheduleTx, setScheduleTx] = useState<TxState>({ status: 'idle' });
  const [executeTx, setExecuteTx] = useState<TxState>({ status: 'idle' });
  const [cancelTx, setCancelTx] = useState<TxState>({ status: 'idle' });

  async function loadMinDelay(): Promise<void> {
    if (!timelockAddr || timelockAddr === '0x') return;
    const d = await ops.getMinDelay(timelockAddr, evm.provider ?? undefined);
    setMinDelay(formatDelay(Number(d)));
  }

  async function handleSchedule(): Promise<void> {
    if (!timelockAddr || !calldata) return;
    setScheduleTx({ status: 'pending' });
    const result = await ops.schedule(timelockAddr, 0n, calldata, predecessor, salt, BigInt(delay));
    setScheduleTx(result);
  }

  async function handleLookup(): Promise<void> {
    if (!timelockAddr || !lookupHash) return;
    setOpState(null);
    setOpEta(null);
    setLookupDebug(null);
    setLookupError(null);
    try {
      const wp = evm.provider ?? undefined;
      // Use getTimestamp — works on both OZ v4 and v5, unambiguous
      const ts = await ops.getTimestamp(timelockAddr, lookupHash, wp);
      const tsNum = Number(ts);
      const now = Math.floor(Date.now() / 1000);
      const network = wp ? await wp.getNetwork() : null;
      setLookupDebug(
        `contract: ${timelockAddr} | hash: ${lookupHash.slice(0, 14)}… | timestamp: ${tsNum} | chain: ${network?.chainId ?? 'public RPC'}`
      );
      let state: OperationState;
      if (tsNum === 0) state = 'Unset';
      else if (tsNum === 1) state = 'Done'; // DONE_TIMESTAMP
      else if (tsNum <= now) state = 'Ready';
      else state = 'Waiting';
      setOpState(state);
      if (state === 'Waiting') setOpEta(formatCountdown(tsNum));
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExecute(): Promise<void> {
    const target = derivedTarget ?? timelockAddr;
    const data = derivedCalldata ?? execCalldata;
    const pred = derivedPredecessor ?? predecessor;
    const s = derivedSalt ?? salt;
    if (!target || !data) return;
    setExecuteTx({ status: 'pending' });
    const result = await ops.execute(target, 0n, data, pred, s);
    setExecuteTx(result);
  }

  async function handleDeriveFromTx(): Promise<void> {
    if (!deriveTxHash) return;
    setDeriving(true);
    setDeriveError(null);
    try {
      const provider = evm.provider ?? new JsonRpcProvider(ARB_SEPOLIA.rpc);
      const receipt = await provider.getTransactionReceipt(deriveTxHash);
      if (!receipt) { setDeriveError('Transaction not found'); return; }
      const iface = new Interface(TimelockControllerABI);
      const eventTopic = iface.getEvent('CallScheduled')!.topicHash;
      const log = receipt.logs.find((l) => l.topics[0] === eventTopic);
      if (!log) { setDeriveError('No CallScheduled event found in this transaction'); return; }
      // id is indexed (topics[1]); target/value/data/predecessor are in log.data
      const id = log.topics[1];
      const decoded = iface.decodeEventLog('CallScheduled', log.data, log.topics);
      setLookupHash(id);
      setDerivedTarget(decoded.target as string);
      setDerivedCalldata(decoded.data as string);
      setDerivedPredecessor(decoded.predecessor as string);

      // Extract salt from the CallSalt event (emitted alongside CallScheduled when salt != 0)
      const saltTopic = iface.getEvent('CallSalt')!.topicHash;
      const saltLog = receipt.logs.find((l) => l.topics[0] === saltTopic && l.topics[1] === id);
      if (saltLog) {
        const saltDecoded = iface.decodeEventLog('CallSalt', saltLog.data, saltLog.topics);
        setDerivedSalt(saltDecoded.salt as string);
      } else {
        setDerivedSalt('0x0000000000000000000000000000000000000000000000000000000000000000');
      }
    } catch (e) {
      setDeriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeriving(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!timelockAddr || !lookupHash) return;
    setCancelTx({ status: 'pending' });
    const result = await ops.cancel(timelockAddr, lookupHash);
    setCancelTx(result);
  }

  return (
    <div>
      <div className="topbar">
        <h2>Timelock — TimelockController</h2>
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
        <h3>TimelockController</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div className="label">TimelockController address</div>
            <input className="input" value={timelockAddr} onChange={(e) => setTimelockAddr(e.target.value)} />
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

        {/* Live calldata + hash preview */}
        <div className="state-block" style={{ marginTop: 12 }}>
          {calldataError && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8 }}>
              Fill in all fields to encode: {calldataError}
            </div>
          )}
          {calldata && (
            <>
              <div className="label">Encoded calldata</div>
              <div style={{ wordBreak: 'break-all', fontSize: 11, color: '#666', marginBottom: 10, fontFamily: 'monospace' }}>{calldata}</div>
            </>
          )}
          {opHash && (
            <div style={{ background: '#0e0e1a', border: '1px solid #3a3a5a', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label" style={{ margin: 0 }}>Operation hash</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => navigator.clipboard.writeText(opHash)}>Copy</button>
                  <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => setLookupHash(opHash)}>Use for lookup</button>
                </div>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#a0a0ff', wordBreak: 'break-all' }}>{opHash}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                Updates live as you change params — matches on-chain hashOperation()
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={handleSchedule} disabled={!evm.isConnected || !calldata}>
            Schedule
          </button>
        </div>

        <div style={{ marginTop: 8 }}><TxStatus state={scheduleTx} /></div>
      </section>

      {/* Lookup */}
      <section className="card">
        <h3>Check Operation State</h3>

        {/* Derive hash from tx hash */}
        <div style={{ marginBottom: 16, padding: '10px 12px', background: '#0e0e1a', borderRadius: 6, border: '1px solid #2a2a3a' }}>
          <div className="label" style={{ marginBottom: 6 }}>Derive hash from schedule tx hash</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input className="input" style={{ flex: 1 }} placeholder="0x… (transaction hash of the schedule call)"
              value={deriveTxHash} onChange={(e) => setDeriveTxHash(e.target.value)} />
            <button className="btn" onClick={handleDeriveFromTx} disabled={deriving || !deriveTxHash}>
              {deriving ? 'Fetching…' : 'Derive'}
            </button>
          </div>
          {deriveError && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 6 }}>{deriveError}</div>}
          <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
            Reads the CallScheduled event from the tx receipt and extracts the operation id
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div className="label">Operation hash (bytes32)</div>
            <input className="input" value={lookupHash} onChange={(e) => setLookupHash(e.target.value)} />
          </div>
          <button className="btn" onClick={handleLookup} disabled={!timelockAddr || !lookupHash}>Lookup</button>
        </div>
        {lookupError && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ff6b6b' }}>Error: {lookupError}</div>
        )}
        {lookupDebug && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#555', fontFamily: 'monospace' }}>{lookupDebug}</div>
        )}
        {opState && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ color: opState === 'Ready' ? '#6bcb77' : opState === 'Unset' ? '#ff6b6b' : opState === 'Done' ? '#888' : '#ffd93d' }}>
                State: <strong>{opState}</strong>
                {opEta && <span style={{ marginLeft: 8, color: '#888' }}>{opEta}</span>}
              </div>

              {opState === 'Ready' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className="btn btn-primary" onClick={handleExecute}
                    disabled={!evm.isConnected || !derivedCalldata}>
                    Execute
                  </button>
                  {!evm.isConnected && <span style={{ fontSize: 11, color: '#888' }}>Connect wallet to execute</span>}
                  {evm.isConnected && !derivedCalldata && <span style={{ fontSize: 11, color: '#888' }}>Use "Derive from tx" above first</span>}
                </div>
              )}

              {(opState === 'Waiting' || opState === 'Ready') && (
                <button className="btn" style={{ background: '#3a1a1a', color: '#ff6b6b', borderColor: '#5a2a2a' }}
                  onClick={handleCancel} disabled={!evm.isConnected}>
                  Cancel
                </button>
              )}

              {opState === 'Done' && (
                <span style={{ fontSize: 12, color: '#555' }}>Already executed — nothing to do</span>
              )}
            </div>

            {/* Debug: show exactly what will be passed to execute */}
            {derivedCalldata && (
              <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', lineHeight: 1.6 }}>
                <div>target: {derivedTarget}</div>
                <div>predecessor: {derivedPredecessor}</div>
                <div>salt: {derivedSalt ?? '(from form)'}</div>
                <div>calldata: {derivedCalldata.slice(0, 18)}…</div>
              </div>
            )}
          </div>
        )}
        {(executeTx.status !== 'idle' || cancelTx.status !== 'idle') && (
          <div style={{ marginTop: 8 }}>
            <TxStatus state={executeTx.status !== 'idle' ? executeTx : cancelTx} />
          </div>
        )}
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
