// bs58 4.x ships no types; chain.ts only uses encode/decode.
declare module 'bs58' {
  const bs58: { encode(bytes: Uint8Array | number[]): string; decode(text: string): Uint8Array };
  export default bs58;
}
