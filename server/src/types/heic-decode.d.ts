declare module 'heic-decode' {
  interface DecodedHeic {
    width: number;
    height: number;
    /** RGBA pixels. */
    data: Uint8ClampedArray;
  }

  interface HeicImageHandle {
    width: number;
    height: number;
    decode(): Promise<DecodedHeic>;
  }

  type HeicImageList = HeicImageHandle[] & {
    /** Frees the WebAssembly memory held by the decoder. */
    dispose(): void;
  };

  interface HeicDecode {
    (input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedHeic>;
    all(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<HeicImageList>;
  }

  const decode: HeicDecode;
  export default decode;
}
