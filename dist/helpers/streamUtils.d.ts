export function calculateFileHash(filePath: string): Promise<Buffer>;
export function calculateByteRangeHash(filePath: string, byteRange: any[]): Promise<Buffer>;
/**
 * Stream Transform que aplica modificações aos dados conforme passam
 * Útil para substituir placeholders durante streaming
 */
export class PlaceholderReplacerTransform extends Transform {
    constructor(replacements?: any[]);
    replacements: any[];
    buffer: Buffer;
    currentPos: number;
    processedReplacements: Set<any>;
    _transform(chunk: any, encoding: any, callback: any): void;
    _flush(callback: any): void;
}
/**
 * Stream Transform que pula uma região específica do arquivo
 * Útil para remover placeholders de assinatura
 */
export class SkipRegionTransform extends Transform {
    constructor(skipStart: any, skipEnd: any);
    skipStart: any;
    skipEnd: any;
    currentPos: number;
    skipped: boolean;
    _transform(chunk: any, encoding: any, callback: any): void;
}
export function copyWithTransforms(inputPath: string, outputPath: string, transforms?: any[]): Promise<void>;
export function findPatternInFile(filePath: string, pattern: Buffer | string): Promise<number | null>;
import { Transform } from 'stream';
//# sourceMappingURL=streamUtils.d.ts.map