import { getNetworkSnapshot, formatNetworkSnapshotHuman } from '../../src/runtime/network/networkSnapshotV0_1.mjs';

// OpenClaw / Agent callable capability
// Name: a2a_network_snapshot
// Returns snapshot JSON + a short human-readable summary.
export async function a2a_network_snapshot(input) {
  // input currently unused; keep for future flags (jsonOnly, maxPeers, etc.)
  try {
    const snap = await getNetworkSnapshot({});
    return {
      ok: true,
      result: {
        snapshot: snap,
        text: formatNetworkSnapshotHuman(snap)
      }
    };
  } catch (e) {
    return { ok: false, error: { code: 'SNAPSHOT_FAILED', reason: String(e?.message || e) } };
  }
}
