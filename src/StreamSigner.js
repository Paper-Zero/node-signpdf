import forge from 'node-forge';
import {createReadStream, createWriteStream, promises as fs} from 'fs';
import {createHash} from 'crypto';
import SignPdfError from './SignPdfError';
import {DEFAULT_BYTE_RANGE_PLACEHOLDER} from './helpers/const';
import {findByteRangeStream} from './helpers/findByteRangeStream';

/**
 * StreamSigner - Version streaming do node-signpdf que elimina o limite de 2GB
 * Permite assinar PDFs de qualquer tamanho usando streams para consumo mínimo de memória
 */
export class StreamSigner {
    constructor() {
        this.byteRangePlaceholder = DEFAULT_BYTE_RANGE_PLACEHOLDER;
        this.lastSignature = null;
    }

    /**
     * Assina um PDF usando streaming para suportar arquivos grandes
     * @param {string} pdfPath - Caminho para o arquivo PDF
     * @param {Buffer} p12Buffer - Certificado P12/PFX como Buffer
     * @param {Object} additionalOptions - Opções adicionais
     * @returns {Promise<string>} Caminho do arquivo assinado
     */
    async sign(pdfPath, p12Buffer, additionalOptions = {}) {
        const options = {
            asn1StrictParsing: false,
            passphrase: '',
            outputPath: null,
            ...additionalOptions,
        };

        this.validateInputs(pdfPath, p12Buffer);
        await this.checkFileExists(pdfPath);

        const outputPath = options.outputPath || pdfPath;
        const byteRangeInfo = await findByteRangeStream(pdfPath);
        const byteRange = await this.calculateByteRange(pdfPath, byteRangeInfo);
        const actualByteRange = this.formatByteRange(byteRange);

        const {privateKey, certificate} = this.prepareCertificate(p12Buffer, options);

        const contentHash = await this.calculateContentHash(
            pdfPath,
            byteRange,
            actualByteRange,
            byteRangeInfo.byteRangePosition,
        );

        const signature = this.createPKCS7Signature(contentHash, privateKey, certificate);

        this.validateSignatureSize(signature, byteRangeInfo.placeholderLength);

        await this.writeSignedPdf(
            pdfPath,
            outputPath,
            byteRange,
            actualByteRange,
            byteRangeInfo,
            signature,
        );

        return outputPath;
    }

    validateInputs(pdfPath, p12Buffer) {
        if (typeof pdfPath !== 'string') {
            throw new SignPdfError(
                'PDF path expected as string.',
                SignPdfError.TYPE_INPUT,
            );
        }

        if (!(p12Buffer instanceof Buffer)) {
            throw new SignPdfError(
                'p12 certificate expected as Buffer.',
                SignPdfError.TYPE_INPUT,
            );
        }
    }

    async checkFileExists(pdfPath) {
        try {
            await fs.access(pdfPath);
        } catch (error) {
            throw new SignPdfError(
                `PDF file not found: ${pdfPath}`,
                SignPdfError.TYPE_INPUT,
            );
        }
    }

    async calculateByteRange(pdfPath, byteRangeInfo) {
        const fileStats = await fs.stat(pdfPath);
        const placeholderLengthWithBrackets = (byteRangeInfo.placeholderEnd + 1)
            - byteRangeInfo.placeholderStart;

        const byteRange = [0, 0, 0, 0];
        byteRange[1] = byteRangeInfo.placeholderStart;
        byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
        byteRange[3] = fileStats.size - byteRange[2];

        return byteRange;
    }

    formatByteRange(byteRange) {
        const actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
        const paddingNeeded = this.byteRangePlaceholder.length - actualByteRange.length;

        if (paddingNeeded < 0) {
            throw new Error(
                `ByteRange too long: ${actualByteRange.length} > ${this.byteRangePlaceholder.length}`,
            );
        }

        const padding = ' '.repeat(paddingNeeded);
        return actualByteRange + padding;
    }

    prepareCertificate(p12Buffer, options) {
        const forgeCert = forge.util.createBuffer(p12Buffer.toString('binary'));
        const p12Asn1 = forge.asn1.fromDer(forgeCert);
        const p12 = forge.pkcs12.pkcs12FromAsn1(
            p12Asn1,
            options.asn1StrictParsing,
            options.passphrase,
        );

        const certBags = p12.getBags({
            bagType: forge.pki.oids.certBag,
        })[forge.pki.oids.certBag];

        const keyBags = p12.getBags({
            bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
        })[forge.pki.oids.pkcs8ShroudedKeyBag];

        const privateKey = keyBags[0].key;
        let certificate;

        Object.keys(certBags).forEach((i) => {
            const {publicKey} = certBags[i].cert;

            if (privateKey.n.compareTo(publicKey.n) === 0
                && privateKey.e.compareTo(publicKey.e) === 0
            ) {
                certificate = certBags[i].cert;
            }
        });

        if (typeof certificate === 'undefined') {
            throw new SignPdfError(
                'Failed to find a certificate that matches the private key.',
                SignPdfError.TYPE_INPUT,
            );
        }

        return {privateKey, certificate};
    }

    async calculateContentHash(pdfPath, byteRange, actualByteRange, byteRangePos) {
        const hash = createHash('sha256');

        return new Promise((resolve, reject) => {
            const stream = createReadStream(pdfPath);
            let currentPos = 0;
            let byteRangeReplaced = false;

            stream.on('data', (chunk) => {
                let processedChunk = chunk;

                if (!byteRangeReplaced && currentPos <= byteRangePos
                    && (currentPos + chunk.length) > byteRangePos) {
                    const localPos = byteRangePos - currentPos;
                    const placeholderLength = this.byteRangePlaceholder.length;
                    const replacementBuffer = Buffer.from(actualByteRange);

                    processedChunk = Buffer.concat([
                        chunk.slice(0, localPos),
                        replacementBuffer,
                        chunk.slice(localPos + placeholderLength),
                    ]);

                    byteRangeReplaced = true;
                }

                const chunkStart = currentPos;
                const chunkEnd = currentPos + processedChunk.length;

                // Primeira parte: do início até o placeholder da assinatura
                if (chunkStart < byteRange[1]) {
                    const endPos = Math.min(chunkEnd, byteRange[1]);
                    const sliceEnd = endPos - chunkStart;
                    hash.update(processedChunk.slice(0, sliceEnd));
                }

                // Segunda parte: após o placeholder da assinatura até o final
                if (chunkEnd > byteRange[2]) {
                    const startPos = Math.max(chunkStart, byteRange[2]);
                    const sliceStart = startPos - chunkStart;
                    hash.update(processedChunk.slice(sliceStart));
                }

                currentPos += chunk.length;
            });

            stream.on('end', () => {
                resolve(hash.digest());
            });

            stream.on('error', reject);
        });
    }

    createPKCS7Signature(contentHash, privateKey, certificate) {
        const p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(contentHash);
        p7.addCertificate(certificate);

        p7.addSigner({
            key: privateKey,
            certificate,
            digestAlgorithm: forge.pki.oids.sha256,
            authenticatedAttributes: [
                {
                    type: forge.pki.oids.contentType,
                    value: forge.pki.oids.data,
                }, {
                    type: forge.pki.oids.signingTime,
                    value: new Date(),
                }, {
                    type: forge.pki.oids.messageDigest,
                },
            ],
        });

        p7.sign({detached: true});
        const raw = forge.asn1.toDer(p7.toAsn1()).getBytes();
        return Buffer.from(raw, 'binary');
    }

    validateSignatureSize(signature, placeholderLength) {
        if ((signature.length * 2) > placeholderLength) {
            throw new SignPdfError(
                `Signature exceeds placeholder length: ${signature.length * 2} > ${placeholderLength}`,
                SignPdfError.TYPE_INPUT,
            );
        }
    }

    async writeSignedPdf(
        inputPath,
        outputPath,
        byteRange,
        actualByteRange,
        byteRangeInfo,
        signature,
    ) {
        let hexSignature = signature.toString('hex');
        this.lastSignature = hexSignature;

        const paddingLength = (byteRangeInfo.placeholderLength / 2) - signature.length;
        if (paddingLength > 0) {
            hexSignature += '0'.repeat(paddingLength * 2);
        }

        const signatureWithBrackets = `<${hexSignature}>`;
        const tempPath = outputPath === inputPath ? `${outputPath}.tmp` : outputPath;

        const readStream = createReadStream(inputPath);
        const writeStream = createWriteStream(tempPath);

        let currentPos = 0;
        let byteRangeReplaced = false;
        let signatureInserted = false;

        return new Promise((resolve, reject) => {
            readStream.on('data', (chunk) => {
                let processedChunk = chunk;
                const chunkStart = currentPos;
                const chunkEnd = currentPos + chunk.length;

                if (!byteRangeReplaced && chunkStart <= byteRangeInfo.byteRangePosition
                    && chunkEnd > byteRangeInfo.byteRangePosition) {
                    const localPos = byteRangeInfo.byteRangePosition - chunkStart;
                    const placeholderLength = this.byteRangePlaceholder.length;
                    const replacementBuffer = Buffer.from(actualByteRange);

                    processedChunk = Buffer.concat([
                        chunk.slice(0, localPos),
                        replacementBuffer,
                        chunk.slice(localPos + placeholderLength),
                    ]);

                    byteRangeReplaced = true;
                }

                if (!signatureInserted && chunkStart <= byteRange[1]
                    && chunkEnd > byteRange[1]) {
                    const localPos = byteRange[1] - chunkStart;

                    if (localPos > 0) {
                        writeStream.write(processedChunk.slice(0, localPos));
                    }

                    writeStream.write(Buffer.from(signatureWithBrackets));

                    const skipLength = byteRange[2] - byteRange[1];
                    const remainingInChunk = processedChunk.length - localPos;

                    if (remainingInChunk > skipLength) {
                        writeStream.write(processedChunk.slice(localPos + skipLength));
                    }

                    signatureInserted = true;
                } else if (signatureInserted || chunkEnd <= byteRange[1]
                    || chunkStart >= byteRange[2]) {
                    writeStream.write(processedChunk);
                }

                currentPos += chunk.length;
            });

            readStream.on('end', async () => {
                writeStream.end();

                writeStream.on('finish', async () => {
                    if (tempPath !== outputPath) {
                        try {
                            await fs.rename(tempPath, outputPath);
                        } catch (error) {
                            reject(error);
                            return;
                        }
                    }
                    resolve();
                });
            });

            readStream.on('error', reject);
            writeStream.on('error', reject);
        });
    }
}

export default new StreamSigner();
