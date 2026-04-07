import { useMemo, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PROGRAM_ID } from './constants';
import idlJson from './idl/smartfarmer.json';
import { Buffer } from 'buffer';

// ============================================================================
// PDA derivation helpers (зеркало логики из контракта)
// ============================================================================

const POOL_ADMIN = new PublicKey('GA6jvomaWL41c5aPX8GnHxq2b2DD9h9GyxZpxSVbZYbr');

export function getPoolPDA(admin: PublicKey = POOL_ADMIN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('insurance_pool'), admin.toBuffer()],
    PROGRAM_ID
  );
}

export function getVaultPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pool.toBuffer()],
    PROGRAM_ID
  );
}

export function getPolicyPDA(pool: PublicKey, policyId: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(policyId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), pool.toBuffer(), buf],
    PROGRAM_ID
  );
}

export function getWeatherReportPDA(policy: PublicKey, reportIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(reportIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('weather_report'), policy.toBuffer(), buf],
    PROGRAM_ID
  );
}

export function getNdviReportPDA(policy: PublicKey, reportIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(reportIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ndvi_report'), policy.toBuffer(), buf],
    PROGRAM_ID
  );
}

export function useSmartFarmer() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idlJson as any, PROGRAM_ID, provider);
  }, [provider]);

  // Read-only program (no wallet needed) for public queries
  const readProgram = useMemo(() => {
    const readOnlyProvider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any,
      { commitment: 'confirmed' }
    );
    return new Program(idlJson as any, PROGRAM_ID, readOnlyProvider);
  }, [connection]);

  // Fetch all policies for the connected wallet
  const fetchMyPolicies = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog || !wallet.publicKey) return [];
    try {
      const allPolicies = await (prog.account as any).policy.all([
        {
          memcmp: {
            offset: 8 + 8 + 32, // discriminator(8) + policyId(8) + pool(32) => farmer starts here
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ]);
      return allPolicies.map((p: any) => ({
        publicKey: p.publicKey,
        ...p.account,
      }));
    } catch (e) {
      console.warn('Failed to fetch policies:', e);
      return [];
    }
  }, [program, readProgram, wallet.publicKey]);

  // Fetch ALL policies (for admin/dashboard view)
  const fetchAllPolicies = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog) return [];
    try {
      const allPolicies = await (prog.account as any).policy.all();
      return allPolicies.map((p: any) => ({
        publicKey: p.publicKey,
        ...p.account,
      }));
    } catch (e) {
      console.warn('Failed to fetch all policies:', e);
      return [];
    }
  }, [program, readProgram]);

  // Fetch pool data
  const fetchPool = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog) return null;
    try {
      const [poolPDA] = getPoolPDA();
      const pool = await (prog.account as any).insurancePool.fetch(poolPDA);
      return { publicKey: poolPDA, ...pool };
    } catch (e) {
      console.warn('Pool not found:', e);
      return null;
    }
  }, [program, readProgram]);

  // Fetch latest weather report for a policy
  const fetchLatestWeatherReport = useCallback(async (policyPubkey: PublicKey) => {
    const prog = program || readProgram;
    if (!prog) return null;
    try {
      // Try fetching the most recent reports by scanning the account list
      const reports = await (prog.account as any).weatherReport.all([
        {
          memcmp: {
            offset: 8, // after discriminator, first field is `policy: Pubkey`
            bytes: policyPubkey.toBase58(),
          },
        },
      ]);
      if (reports.length === 0) return null;
      // Sort by timestamp descending, return the latest
      reports.sort((a: any, b: any) => (b.account.timestamp?.toNumber?.() || 0) - (a.account.timestamp?.toNumber?.() || 0));
      return reports[0].account;
    } catch (e) {
      console.warn('Failed to fetch weather reports:', e);
      return null;
    }
  }, [program, readProgram]);

  // Fetch latest NDVI report for a policy
  const fetchLatestNdviReport = useCallback(async (policyPubkey: PublicKey) => {
    const prog = program || readProgram;
    if (!prog) return null;
    try {
      const reports = await (prog.account as any).ndviReport.all([
        {
          memcmp: {
            offset: 8,
            bytes: policyPubkey.toBase58(),
          },
        },
      ]);
      if (reports.length === 0) return null;
      reports.sort((a: any, b: any) => (b.account.timestamp?.toNumber?.() || 0) - (a.account.timestamp?.toNumber?.() || 0));
      return reports[0].account;
    } catch (e) {
      console.warn('Failed to fetch NDVI reports:', e);
      return null;
    }
  }, [program, readProgram]);

  // Fetch ALL weather reports across all policies (for dashboard)
  const fetchAllWeatherReports = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog) return [];
    try {
      const reports = await (prog.account as any).weatherReport.all();
      return reports.map((r: any) => r.account).sort(
        (a: any, b: any) => (b.timestamp?.toNumber?.() || 0) - (a.timestamp?.toNumber?.() || 0)
      );
    } catch (e) {
      console.warn('Failed to fetch weather reports:', e);
      return [];
    }
  }, [program, readProgram]);

  // Fetch ALL NDVI reports across all policies (for dashboard)
  const fetchAllNdviReports = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog) return [];
    try {
      const reports = await (prog.account as any).ndviReport.all();
      return reports.map((r: any) => r.account).sort(
        (a: any, b: any) => (b.timestamp?.toNumber?.() || 0) - (a.timestamp?.toNumber?.() || 0)
      );
    } catch (e) {
      console.warn('Failed to fetch NDVI reports:', e);
      return [];
    }
  }, [program, readProgram]);

  // Fetch ALL recommendations across all policies (for history page)
  const fetchAllRecommendations = useCallback(async () => {
    const prog = program || readProgram;
    if (!prog) return [];
    try {
      const recs = await (prog.account as any).recommendation.all();
      return recs.map((r: any) => r.account).sort(
        (a: any, b: any) => (b.timestamp?.toNumber?.() || 0) - (a.timestamp?.toNumber?.() || 0)
      );
    } catch (e) {
      console.warn('Failed to fetch recommendations:', e);
      return [];
    }
  }, [program, readProgram]);

  // Purchase a new policy
  const purchasePolicy = async (params: {
    poolAdmin: PublicKey;
    latitude: number;
    longitude: number;
    areaHectares: number;
    cropType: any;
    frostTriggerTemp: number;
    droughtTriggerPrecip: number;
    droughtPeriodDays: number;
    ndviDropTrigger: number;
    premiumAmount: number;
    maxCoverage: number;
    coverageStart: number;
    coverageEnd: number;
    farmerTokenAccount: PublicKey;
  }) => {
    if (!program || !wallet.publicKey) throw new Error('Wallet not connected');

    const [poolPDA] = getPoolPDA(params.poolAdmin);
    const [vaultPDA] = getVaultPDA(poolPDA);
    
    // Fetch pool to get policy count for PDA
    const pool = await (program.account as any).insurancePool.fetch(poolPDA);
    const [policyPDA] = getPolicyPDA(poolPDA, Number((pool as any).policyCount));

    const tx = await program.methods
      .purchasePolicy(
        new BN(params.latitude * 1_000_000),
        new BN(params.longitude * 1_000_000),
        params.areaHectares * 100,
        params.cropType,
        params.frostTriggerTemp * 100,
        params.droughtTriggerPrecip * 100,
        params.droughtPeriodDays,
        Math.floor(params.ndviDropTrigger * 10000),
        new BN(params.premiumAmount),
        new BN(params.maxCoverage),
        new BN(params.coverageStart),
        new BN(params.coverageEnd),
      )
      .accounts({
        farmer: wallet.publicKey,
        pool: poolPDA,
        policy: policyPDA,
        farmerTokenAccount: params.farmerTokenAccount,
        vault: vaultPDA,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  };

  return {
    program,
    readProgram,
    provider,
    connected: wallet.connected,
    publicKey: wallet.publicKey,
    fetchMyPolicies,
    fetchAllPolicies,
    fetchPool,
    fetchLatestWeatherReport,
    fetchLatestNdviReport,
    fetchAllWeatherReports,
    fetchAllNdviReports,
    fetchAllRecommendations,
    purchasePolicy,
  };
}
