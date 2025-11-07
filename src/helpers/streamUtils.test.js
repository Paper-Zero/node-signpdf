import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
    calculateFileHash,
    calculateByteRangeHash,
    PlaceholderReplacerTransform,
    SkipRegionTransform,
    copyWithTransforms,
    findPatternInFile
} from './streamUtils';

describe('streamUtils', () => {
    const tempDir = path.join(__dirname, 'temp-stream');

    beforeAll(async () => {
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (error) {
            // Diretório já existe
        }
    });

    afterAll(async () => {
        try {
            const files = await fs.readdir(tempDir);
            for (const file of files) {
                await fs.unlink(path.join(tempDir, file));
            }
            await fs.rmdir(tempDir);
        } catch (error) {
            // Ignorar erros de limpeza
        }
    });

    describe('calculateFileHash', () => {
        test('should calculate correct SHA-256 hash of file', async () => {
            const testFile = path.join(tempDir, 'test-hash.txt');
            const content = 'Hello, World!';
            
            await fs.writeFile(testFile, content);
            
            const hash = await calculateFileHash(testFile);
            
            // Verificar com hash esperado
            const expectedHash = createHash('sha256').update(content).digest();
            expect(hash).toEqual(expectedHash);
        });

        test('should handle large files efficiently', async () => {
            const testFile = path.join(tempDir, 'large-file.txt');
            const content = 'A'.repeat(1024 * 1024); // 1MB
            
            await fs.writeFile(testFile, content);
            
            const startTime = Date.now();
            const hash = await calculateFileHash(testFile);
            const endTime = Date.now();
            
            expect(hash).toBeInstanceOf(Buffer);
            expect(hash.length).toBe(32); // SHA-256 produces 32 bytes
            expect(endTime - startTime).toBeLessThan(5000); // Deve ser rápido (< 5s)
        });
    });

    describe('calculateByteRangeHash', () => {
        test('should calculate hash of specific byte ranges', async () => {
            const testFile = path.join(tempDir, 'byterange-test.txt');
            const content = '0123456789ABCDEFGHIJ'; // 20 bytes
            
            await fs.writeFile(testFile, content);
            
            // ByteRange: [0, 5, 10, 5] -> '01234' + 'ABCDE'
            const hash = await calculateByteRangeHash(testFile, [0, 5, 10, 5]);
            
            const expectedContent = '01234ABCDE';
            const expectedHash = createHash('sha256').update(expectedContent).digest();
            
            expect(hash).toEqual(expectedHash);
        });

        test('should handle overlapping ranges correctly', async () => {
            const testFile = path.join(tempDir, 'overlap-test.txt');
            const content = 'ABCDEFGHIJKLMNOP'; // 16 bytes
            
            await fs.writeFile(testFile, content);
            
            // ByteRange: [0, 10, 5, 10] -> 'ABCDEFGHIJ' + 'FGHIJKLMNO'
            const hash = await calculateByteRangeHash(testFile, [0, 10, 5, 10]);
            
            const expectedContent = 'ABCDEFGHIJFGHIJKLMNO';
            const expectedHash = createHash('sha256').update(expectedContent).digest();
            
            expect(hash).toEqual(expectedHash);
        });
    });

    describe('PlaceholderReplacerTransform', () => {
        test('should replace placeholders in stream', async () => {
            const testFile = path.join(tempDir, 'placeholder-input.txt');
            const outputFile = path.join(tempDir, 'placeholder-output.txt');
            const content = 'Hello **PLACEHOLDER** World!';
            
            await fs.writeFile(testFile, content);
            
            const replacements = [{
                search: Buffer.from('**PLACEHOLDER**'),
                replace: Buffer.from('REPLACED')
            }];
            
            const transformer = new PlaceholderReplacerTransform(replacements);
            
            await copyWithTransforms(testFile, outputFile, [transformer]);
            
            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe('Hello REPLACED World!');
        });

        test('should handle position-based replacements', async () => {
            const testFile = path.join(tempDir, 'position-input.txt');
            const outputFile = path.join(tempDir, 'position-output.txt');
            const content = '0123456789';
            
            await fs.writeFile(testFile, content);
            
            const replacements = [{
                search: Buffer.from('456'),
                replace: Buffer.from('XYZ'),
                position: 4 // Posição onde '456' começa
            }];
            
            const transformer = new PlaceholderReplacerTransform(replacements);
            
            await copyWithTransforms(testFile, outputFile, [transformer]);
            
            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe('0123XYZ789');
        });
    });

    describe('SkipRegionTransform', () => {
        test('should skip specified region in stream', async () => {
            const testFile = path.join(tempDir, 'skip-input.txt');
            const outputFile = path.join(tempDir, 'skip-output.txt');
            const content = '0123456789ABCDEF';
            
            await fs.writeFile(testFile, content);
            
            // Pular região de posição 5 a 10 (inclusive) -> '56789'
            const transformer = new SkipRegionTransform(5, 10);
            
            await copyWithTransforms(testFile, outputFile, [transformer]);
            
            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe('01234ABCDEF');
        });

        test('should handle edge cases correctly', async () => {
            const testFile = path.join(tempDir, 'skip-edge-input.txt');
            const outputFile = path.join(tempDir, 'skip-edge-output.txt');
            const content = '0123456789';
            
            await fs.writeFile(testFile, content);
            
            // Pular região do início (0 a 3)
            const transformer = new SkipRegionTransform(0, 3);
            
            await copyWithTransforms(testFile, outputFile, [transformer]);
            
            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe('3456789');
        });
    });

    describe('findPatternInFile', () => {
        test('should find pattern in file', async () => {
            const testFile = path.join(tempDir, 'pattern-test.txt');
            const content = 'The quick brown fox jumps over the lazy dog';
            
            await fs.writeFile(testFile, content);
            
            const position = await findPatternInFile(testFile, 'brown');
            expect(position).toBe(10); // 'brown' starts at position 10
        });

        test('should return null for non-existent pattern', async () => {
            const testFile = path.join(tempDir, 'no-pattern-test.txt');
            const content = 'Hello World';
            
            await fs.writeFile(testFile, content);
            
            const position = await findPatternInFile(testFile, 'xyz');
            expect(position).toBeNull();
        });

        test('should handle large files efficiently', async () => {
            const testFile = path.join(tempDir, 'large-pattern-test.txt');
            const content = 'A'.repeat(1024 * 100) + 'TARGET' + 'B'.repeat(1024 * 100); // 200KB with target in middle
            
            await fs.writeFile(testFile, content);
            
            const startTime = Date.now();
            const position = await findPatternInFile(testFile, 'TARGET');
            const endTime = Date.now();
            
            expect(position).toBe(1024 * 100);
            expect(endTime - startTime).toBeLessThan(1000); // Deve ser rápido (< 1s)
        });
    });

    describe('copyWithTransforms', () => {
        test('should copy file with multiple transforms', async () => {
            const testFile = path.join(tempDir, 'multi-transform-input.txt');
            const outputFile = path.join(tempDir, 'multi-transform-output.txt');
            const content = 'Hello **PLACEHOLDER** World **PLACEHOLDER2**!';
            
            await fs.writeFile(testFile, content);
            
            const replacer1 = new PlaceholderReplacerTransform([{
                search: Buffer.from('**PLACEHOLDER**'),
                replace: Buffer.from('FIRST')
            }]);
            
            const replacer2 = new PlaceholderReplacerTransform([{
                search: Buffer.from('**PLACEHOLDER2**'),
                replace: Buffer.from('SECOND')
            }]);
            
            await copyWithTransforms(testFile, outputFile, [replacer1, replacer2]);
            
            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe('Hello FIRST World SECOND!');
        });
    });
});