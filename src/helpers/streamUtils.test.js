import {promises as fs} from 'fs';
import path from 'path';
import {createHash} from 'crypto';
import {
    calculateFileHash,
    calculateByteRangeHash,
    copyWithTransforms,
    findPatternInFile,
} from './streamUtils';

describe('streamUtils', () => {
    const tempDir = path.join(__dirname, 'temp-stream');

    beforeAll(async () => {
        try {
            await fs.mkdir(tempDir, {recursive: true});
        } catch (error) {
            // Diretório já existe
        }
    });

    afterAll(async () => {
        try {
            const files = await fs.readdir(tempDir);
            await Promise.all(files.map((file) => fs.unlink(path.join(tempDir, file))));
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
            const testFile = path.join(tempDir, 'large-test.txt');
            const content = 'A'.repeat(1024 * 1024); // 1MB

            await fs.writeFile(testFile, content);

            const startTime = Date.now();
            const hash = await calculateFileHash(testFile);
            const endTime = Date.now();

            expect(hash).toBeInstanceOf(Buffer);
            expect(hash.length).toBe(32); // SHA-256 digest length
            expect(endTime - startTime).toBeLessThan(5000); // Deve ser rápido (< 5s)
        });
    });

    describe('calculateByteRangeHash', () => {
        test('should calculate hash of specific byte ranges', async () => {
            const testFile = path.join(tempDir, 'byte-range-test.txt');
            const content = '0123456789ABCDEFGHIJ'; // 20 bytes

            await fs.writeFile(testFile, content);

            // ByteRange: [0, 5, 10, 5] -> '01234' + 'ABCDE'
            const hash = await calculateByteRangeHash(testFile, [0, 5, 10, 5]);

            // Verificar com hash esperado
            const expectedContent = '01234ABCDE';
            const expectedHash = createHash('sha256').update(expectedContent).digest();
            expect(hash).toEqual(expectedHash);
        });
    });

    describe('findPatternInFile', () => {
        test('should find pattern in file', async () => {
            const testFile = path.join(tempDir, 'pattern-test.txt');
            const content = 'Hello, World! This is a test.';

            await fs.writeFile(testFile, content);

            const position = await findPatternInFile(testFile, 'World');
            expect(position).toBe(7);
        });

        test('should return null for non-existent pattern', async () => {
            const testFile = path.join(tempDir, 'no-pattern-test.txt');
            const content = 'Hello, World!';

            await fs.writeFile(testFile, content);

            const position = await findPatternInFile(testFile, 'xyz');
            expect(position).toBeNull();
        });

        test('should handle large files efficiently', async () => {
            const testFile = path.join(tempDir, 'large-pattern-test.txt');
            const targetText = 'TARGET';
            const prefix = 'A'.repeat(1024 * 100);
            const suffix = 'B'.repeat(1024 * 100);
            const content = prefix + targetText + suffix;

            await fs.writeFile(testFile, content);

            const startTime = Date.now();
            const foundPosition = await findPatternInFile(testFile, targetText);
            const endTime = Date.now();

            // O pattern deve estar na posição certa (após o prefix)
            expect(foundPosition).toBe(prefix.length);
            expect(endTime - startTime).toBeLessThan(1000); // Deve ser rápido (< 1s)
        });
    });

    describe('copyWithTransforms', () => {
        test('should copy file without transforms', async () => {
            const testFile = path.join(tempDir, 'copy-source.txt');
            const outputFile = path.join(tempDir, 'copy-dest.txt');
            const content = 'This is a test file for copying.';

            await fs.writeFile(testFile, content);

            await copyWithTransforms(testFile, outputFile, []);

            const result = await fs.readFile(outputFile, 'utf8');
            expect(result).toBe(content);
        });
    });
});
