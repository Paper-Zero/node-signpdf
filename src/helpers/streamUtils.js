import { createReadStream, createWriteStream } from 'fs';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

/**
 * Calcula hash SHA-256 de um arquivo usando streams
 * Evita carregar o arquivo inteiro na memória
 * @param {string} filePath - Caminho do arquivo
 * @returns {Promise<Buffer>} Hash SHA-256 do arquivo
 */
export const calculateFileHash = async (filePath) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    
    await pipeline(stream, hash);
    return hash.digest();
};

/**
 * Calcula hash SHA-256 de partes específicas de um arquivo (ByteRange)
 * @param {string} filePath - Caminho do arquivo
 * @param {Array} byteRange - Array [start1, length1, start2, length2]
 * @returns {Promise<Buffer>} Hash SHA-256 das partes especificadas
 */
export const calculateByteRangeHash = async (filePath, byteRange) => {
    const hash = createHash('sha256');
    
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        let currentPos = 0;
        
        // ByteRange: [start1, length1, start2, length2]
        const [start1, length1, start2, length2] = byteRange;
        const end1 = start1 + length1;
        const end2 = start2 + length2;
        
        stream.on('data', (chunk) => {
            const chunkStart = currentPos;
            const chunkEnd = currentPos + chunk.length;
            
            // Primeira parte: [start1, start1 + length1)
            if (chunkStart < end1 && chunkEnd > start1) {
                const sliceStart = Math.max(0, start1 - chunkStart);
                const sliceEnd = Math.min(chunk.length, end1 - chunkStart);
                hash.update(chunk.slice(sliceStart, sliceEnd));
            }
            
            // Segunda parte: [start2, start2 + length2)
            if (chunkStart < end2 && chunkEnd > start2) {
                const sliceStart = Math.max(0, start2 - chunkStart);
                const sliceEnd = Math.min(chunk.length, end2 - chunkStart);
                hash.update(chunk.slice(sliceStart, sliceEnd));
            }
            
            currentPos += chunk.length;
        });
        
        stream.on('end', () => {
            resolve(hash.digest());
        });
        
        stream.on('error', reject);
    });
};

/**
 * Stream Transform que aplica modificações aos dados conforme passam
 * Útil para substituir placeholders durante streaming
 */
export class PlaceholderReplacerTransform extends Transform {
    constructor(replacements = []) {
        super();
        this.replacements = replacements; // Array de {search: Buffer, replace: Buffer, position?: number}
        this.buffer = Buffer.alloc(0);
        this.currentPos = 0;
        this.processedReplacements = new Set();
    }
    
    _transform(chunk, encoding, callback) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        
        // Aplicar substituições se necessário
        for (const replacement of this.replacements) {
            if (this.processedReplacements.has(replacement)) continue;
            
            if (replacement.position !== undefined) {
                // Substituição baseada em posição
                if (this.currentPos <= replacement.position && 
                    (this.currentPos + this.buffer.length) > replacement.position) {
                    
                    const localPos = replacement.position - this.currentPos;
                    this.buffer = Buffer.concat([
                        this.buffer.slice(0, localPos),
                        replacement.replace,
                        this.buffer.slice(localPos + replacement.search.length)
                    ]);
                    
                    this.processedReplacements.add(replacement);
                }
            } else {
                // Substituição baseada em busca
                const searchIndex = this.buffer.indexOf(replacement.search);
                if (searchIndex !== -1) {
                    this.buffer = Buffer.concat([
                        this.buffer.slice(0, searchIndex),
                        replacement.replace,
                        this.buffer.slice(searchIndex + replacement.search.length)
                    ]);
                    
                    this.processedReplacements.add(replacement);
                }
            }
        }
        
        // Manter buffer limitado para substituições futuras
        const maxBuffer = 8192; // 8KB
        if (this.buffer.length > maxBuffer) {
            const outputSize = this.buffer.length - (maxBuffer / 2);
            this.push(this.buffer.slice(0, outputSize));
            this.buffer = this.buffer.slice(outputSize);
            this.currentPos += outputSize;
        }
        
        callback();
    }
    
    _flush(callback) {
        if (this.buffer.length > 0) {
            this.push(this.buffer);
        }
        callback();
    }
}

/**
 * Stream Transform que pula uma região específica do arquivo
 * Útil para remover placeholders de assinatura
 */
export class SkipRegionTransform extends Transform {
    constructor(skipStart, skipEnd) {
        super();
        this.skipStart = skipStart;
        this.skipEnd = skipEnd;
        this.currentPos = 0;
        this.skipped = false;
    }
    
    _transform(chunk, encoding, callback) {
        const chunkStart = this.currentPos;
        const chunkEnd = this.currentPos + chunk.length;
        
        if (chunkEnd <= this.skipStart || chunkStart >= this.skipEnd) {
            // Chunk está completamente fora da região de skip
            this.push(chunk);
        } else {
            // Chunk contém parte da região de skip
            if (chunkStart < this.skipStart) {
                // Parte do chunk antes da região de skip
                const beforeSkip = chunk.slice(0, this.skipStart - chunkStart);
                this.push(beforeSkip);
            }
            
            if (chunkEnd > this.skipEnd) {
                // Parte do chunk após a região de skip
                const afterSkip = chunk.slice(this.skipEnd - chunkStart);
                this.push(afterSkip);
            }
            
            this.skipped = true;
        }
        
        this.currentPos += chunk.length;
        callback();
    }
}

/**
 * Copia arquivo aplicando transformações durante o streaming
 * @param {string} inputPath - Arquivo de entrada
 * @param {string} outputPath - Arquivo de saída
 * @param {Array} transforms - Array de streams Transform a aplicar
 * @returns {Promise<void>}
 */
export const copyWithTransforms = async (inputPath, outputPath, transforms = []) => {
    const readStream = createReadStream(inputPath);
    const writeStream = createWriteStream(outputPath);
    
    let pipeline = readStream;
    for (const transform of transforms) {
        pipeline = pipeline.pipe(transform);
    }
    
    return new Promise((resolve, reject) => {
        pipeline.pipe(writeStream);
        
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        readStream.on('error', reject);
    });
};

/**
 * Encontra a primeira ocorrência de um padrão em um arquivo usando streams
 * @param {string} filePath - Caminho do arquivo
 * @param {Buffer|string} pattern - Padrão a procurar
 * @returns {Promise<number|null>} Posição do padrão ou null se não encontrado
 */
export const findPatternInFile = async (filePath, pattern) => {
    const searchPattern = Buffer.isBuffer(pattern) ? pattern : Buffer.from(pattern);
    
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        let buffer = Buffer.alloc(0);
        let position = 0;
        let found = false;
        
        stream.on('data', (chunk) => {
            if (found) return;
            
            buffer = Buffer.concat([buffer, chunk]);
            
            const index = buffer.indexOf(searchPattern);
            if (index !== -1) {
                found = true;
                stream.destroy();
                resolve(position + index);
                return;
            }
            
            position += chunk.length;
            
            // Manter buffer limitado mas preservar dados suficientes para busca
            if (buffer.length > searchPattern.length + 1024) {
                const keepSize = searchPattern.length + 512;
                position -= (buffer.length - keepSize);
                buffer = buffer.slice(-keepSize);
            }
        });
        
        stream.on('end', () => {
            resolve(found ? null : null);
        });
        
        stream.on('error', reject);
    });
};