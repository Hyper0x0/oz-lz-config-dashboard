import { useState } from 'react';
import { TxStatus } from '@/components/TxStatus';
import { isStarknet } from '@/config/lzCatalog';
import type { TxState } from '@/types';
import type { StepProps } from '../types';
import { explorerTxUrl } from '../types';
import { NetworkHint } from './StepDelegate';

function addrToBytes32(addr: string): string {
  try { return '0x' + BigInt(addr).toString(16).padStart(64, '0'); }
  catch { return ''; }
}

export function StepPeers({ home, remote, hooks, verifyResult, onTxSuccess }: StepProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [homeTx, setHomeTx] = useState<TxState>({ status: 'idle' });
  const [remoteTx, setRemoteTx] = useState<TxState>({ status: 'idle' });

  const homePeerBytes32 = remote.contractAddr ? addrToBytes32(remote.contractAddr) : '';
  const remotePeerBytes32 = home.contractAddr ? addrToBytes32(home.contractAddr) : '';

  async function handleHome(): Promise<void> {
    setHomeTx({ status: 'pending' });
    let result: TxState;
    if (home.kind === 'starknet') {
      result = await hooks.cairo.setPeer(home.contractAddr, remote.chain.eid, remote.contractAddr);
    } else if (isStarknet(remote.chain)) {
      result = await hooks.wiring.setEvmPeer(home.contractAddr, remote.chain.eid, remote.contractAddr);
    } else {
      result = await hooks.wiring.setEvmPeer(home.contractAddr, remote.chain.eid, remote.contractAddr);
    }
    setHomeTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  async function handleRemote(): Promise<void> {
    setRemoteTx({ status: 'pending' });
    let result: TxState;
    if (remote.kind === 'starknet') {
      result = await hooks.cairo.setPeer(remote.contractAddr, home.chain.eid, home.contractAddr);
    } else {
      result = await hooks.wiring.setEvmPeer(remote.contractAddr, home.chain.eid, home.contractAddr);
    }
    setRemoteTx(result);
    if (result.status === 'success') onTxSuccess();
  }

  return (
    <div>
      <div className="step-warn-banner mb-3">
        ⚠ Setting peers opens the messaging channel. Tokens can flow immediately.
        Complete all configuration steps on both sides first.
      </div>

      <div className="step-actions mb-3">
        <div>
          <div className="label mb-1">{home.chainLabel} → {remote.chainLabel}</div>
          <div className="mono-block mb-2">{homePeerBytes32 || '(enter remote address above)'}</div>
        </div>
        <div>
          <div className="label mb-1">{remote.chainLabel} → {home.chainLabel}</div>
          <div className="mono-block mb-2">{remotePeerBytes32 || '(enter home address above)'}</div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer mb-4" style={{ color: 'var(--text)' }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I confirm all previous steps are complete and the addresses are correct.
      </label>

      <div className="step-actions">
        <div>
          <NetworkHint side={home} />
          <button className="btn btn-primary"
            disabled={!confirmed || !home.isConnected || home.needsNetworkSwitch}
            onClick={handleHome}>
            Set Peer on {home.chainLabel}
          </button>
          <div className="mt-1.5"><TxStatus state={homeTx} explorerUrl={explorerTxUrl(home)} /></div>
        </div>
        <div>
          <NetworkHint side={remote} />
          <button className="btn btn-primary"
            disabled={!confirmed || !remote.isConnected || remote.needsNetworkSwitch}
            onClick={handleRemote}>
            Set Peer on {remote.chainLabel}
          </button>
          <div className="mt-1.5"><TxStatus state={remoteTx} explorerUrl={explorerTxUrl(remote)} /></div>
        </div>
      </div>
    </div>
  );
}
