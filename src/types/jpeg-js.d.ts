declare module "jpeg-js" {
  export type RawImageData = {
    width: number;
    height: number;
    data: Uint8Array | Buffer;
  };

  export function encode(
    imageData: RawImageData,
    quality?: number,
  ): { data: Buffer; width: number; height: number };
}
