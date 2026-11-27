// web3.js expects Node's Buffer; must be imported before @solana/web3.js (ES imports run in order).
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
