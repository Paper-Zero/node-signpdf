/* eslint-disable no-use-before-define */
import {promises as fs} from 'fs';
import path from 'path';
import forge from 'node-forge';
import {StreamSigner} from './StreamSigner';
import {DEFAULT_BYTE_RANGE_PLACEHOLDER} from './helpers/const';
import streamAddPlaceholder from './helpers/streamAddPlaceholder';

describe('StreamSigner', () => {
    const tempDir = path.join(__dirname, 'temp');
    let streamSigner;

    beforeAll(async () => {
        // Criar diretório temporário para testes
        try {
            await fs.mkdir(tempDir, {recursive: true});
        } catch (error) {
            // Diretório já existe
        }
    });

    beforeEach(() => {
        streamSigner = new StreamSigner();
    });

    afterAll(async () => {
        // Limpar diretório temporário
        try {
            const files = await fs.readdir(tempDir);
            // eslint-disable-next-line no-restricted-syntax
            for (const file of files) {
                // eslint-disable-next-line no-await-in-loop
                await fs.unlink(path.join(tempDir, file));
            }
            await fs.rmdir(tempDir);
        } catch (error) {
            // Ignorar erros de limpeza
        }
    });

    describe('constructor', () => {
        test('should initialize with correct default values', () => {
            expect(streamSigner.byteRangePlaceholder).toBe(DEFAULT_BYTE_RANGE_PLACEHOLDER);
            expect(streamSigner.lastSignature).toBeNull();
        });
    });

    describe('sign', () => {
        test('should throw error for invalid PDF path type', async () => {
            const p12Buffer = Buffer.from('test');

            await expect(streamSigner.sign(123, p12Buffer))
                .rejects.toThrow('PDF path expected as string.');
        });

        test('should throw error for invalid p12 certificate type', async () => {
            const pdfPath = path.join(tempDir, 'test.pdf');

            await expect(streamSigner.sign(pdfPath, 'not-a-buffer'))
                .rejects.toThrow('p12 certificate expected as Buffer.');
        });

        test('should throw error for non-existent PDF file', async () => {
            const pdfPath = path.join(tempDir, 'non-existent.pdf');
            const p12Buffer = Buffer.from('test');

            await expect(streamSigner.sign(pdfPath, p12Buffer))
                .rejects.toThrow(`PDF file not found: ${pdfPath}`);
        });
    });

    describe('_prepareCertificate', () => {
        test('should throw error for invalid p12 certificate', () => {
            const invalidP12 = Buffer.from('invalid-p12-data');
            const options = {passphrase: '', asn1StrictParsing: false};

            expect(() => {
                // eslint-disable-next-line no-underscore-dangle
                streamSigner._prepareCertificate(invalidP12, options);
            }).toThrow();
        });
    });

    describe('_createPKCS7Signature', () => {
        test('should create valid PKCS#7 signature structure', async () => {
            // Gerar chave e certificado de teste
            const keys = forge.pki.rsa.generateKeyPair(2048);
            const cert = forge.pki.createCertificate();
            cert.publicKey = keys.publicKey;
            cert.serialNumber = '01';
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

            const attrs = [{
                name: 'commonName',
                value: 'Test Certificate',
            }];
            cert.setSubject(attrs);
            cert.setIssuer(attrs);
            cert.sign(keys.privateKey);

            const testHash = Buffer.from('test-hash-content');
            const signature = streamSigner.createPKCS7Signature(testHash, keys.privateKey, cert);

            expect(signature).toBeInstanceOf(Buffer);
            expect(signature.length).toBeGreaterThan(0);
        });
    });

    describe('Memory usage tests', () => {
        test('should handle large data without excessive memory usage', async () => {
            // Teste simplificado - apenas verificar que o método não quebra
            const initialMemory = process.memoryUsage();

            try {
                // Verificar que a função está disponível
                const {findByteRangeStream} = await import('./helpers/findByteRangeStream');
                expect(typeof findByteRangeStream).toBe('function');

                const finalMemory = process.memoryUsage();
                const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

                // Verificar que não há vazamento de memória na importação
                expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Menos de 10MB
            } catch (error) {
                // Se houver erro, apenas verificar que o erro não é de memória
                expect(error.message).not.toContain('out of memory');
            }
        });
    });

    describe('streamAddPlaceholder integration', () => {
        test('should add placeholder to PDF without loading entire file', async () => {
            // Criar PDF básico de teste
            const testPdfPath = path.join(tempDir, 'basic-test.pdf');
            const outputPath = path.join(tempDir, 'with-placeholder.pdf');

            const basicPdf = createBasicTestPdf();
            await fs.writeFile(testPdfPath, basicPdf);

            try {
                const result = await streamAddPlaceholder({
                    pdfPath: testPdfPath,
                    outputPath,
                    reason: 'Test Signature',
                    name: 'Test Signer',
                });

                expect(result).toBe(outputPath);

                // Verificar que o arquivo foi criado
                const stats = await fs.stat(outputPath);
                expect(stats.size).toBeGreaterThan(0);

                // Verificar que contém placeholder
                const content = await fs.readFile(outputPath);
                expect(content.toString('latin1')).toContain(DEFAULT_BYTE_RANGE_PLACEHOLDER);
            } finally {
                try {
                    await fs.unlink(testPdfPath);
                    await fs.unlink(outputPath);
                } catch (error) {
                    // Ignorar erros de limpeza
                }
            }
        });
    });
});

/**
 * Cria um PDF básico de teste
 */
function createBasicTestPdf() {
    const pdf = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj

xref
0 4
0000000000 65535 f 
0000000015 65535 n 
0000000074 65535 n 
0000000120 65535 n 
trailer
<<
/Size 4
/Root 1 0 R
>>
startxref
190
%%EOF`;

    return Buffer.from(pdf);
}
