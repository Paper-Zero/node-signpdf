export function calculateFileHash(filePath: string): Promise<Buffer>;
export function calculateByteRangeHash(filePath: string, byteRange: number[]): Promise<Buffer>;
export function findPatternInFile(filePath: string, pattern: Buffer | string): Promise<number | null>;
export function copyWithTransforms(inputPath: string, outputPath: string, transforms?: Transform[]): Promise<void>;
//# sourceMappingURL=streamUtils.d.ts.map