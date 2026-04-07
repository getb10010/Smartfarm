import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Buffer } from 'buffer';
import App from './App';
import SolanaProvider from './lib/SolanaProvider';
import { TelegramProvider } from './lib/TelegramProvider';
import './index.css';

// Polyfill Buffer for Solana web3.js in browser
(window as any).Buffer = Buffer;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TelegramProvider>
      <BrowserRouter>
        <SolanaProvider>
          <App />
        </SolanaProvider>
      </BrowserRouter>
    </TelegramProvider>
  </React.StrictMode>
);
