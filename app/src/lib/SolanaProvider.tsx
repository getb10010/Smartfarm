import { type FC, type ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { RPC_ENDPOINT, PROGRAM_ID } from './constants';

// Wallet Adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

// Dialect Protocol Integration — wrapped in error boundary for graceful fallback
import { DialectSolanaSdk } from '@dialectlabs/react-sdk-blockchain-solana';

interface Props {
  children: ReactNode;
}



function DialectWrapper({ children }: { children: ReactNode }) {
  try {
    return (
      <DialectSolanaSdk
        dappAddress={PROGRAM_ID.toBase58()}
      >
        {children}
      </DialectSolanaSdk>
    );
  } catch {
    console.warn('[Dialect] SDK initialization failed, running without notifications');
    return <>{children}</>;
  }
}

const SolanaProvider: FC<Props> = ({ children }) => {
  const endpoint = RPC_ENDPOINT;

  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <DialectWrapper>
          <WalletModalProvider>
            {children}
          </WalletModalProvider>
        </DialectWrapper>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default SolanaProvider;
