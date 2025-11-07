import forge from 'node-forge';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import SignPdfError from './SignPdfError';
import { removeTrailingNewLine } from './helpers';
import { DEFAULT_BYTE_RANGE_PLACEHOLDER } from './helpers/const';
import { findByteRangeStream } from './helpers/findByteRangeStream';
import { calculateByteRangeHash, PlaceholderReplacerTransform } from './helpers/streamUtils';
import streamAddPlaceholder from './helpers/streamAddPlaceholder';

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
            outputPath: null, // Se null, sobrescreve o arquivo original
            ...additionalOptions,
        };

        // Validações básicas
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

        // Verifica se o arquivo existe
        try {
            await fs.access(pdfPath);
        } catch (error) {
            throw new SignPdfError(
                `PDF file not found: ${pdfPath}`,
                SignPdfError.TYPE_INPUT,
            );
        }

        const outputPath = options.outputPath || pdfPath;

        // Passo 1: Encontrar ByteRange placeholder no PDF usando stream
        const byteRangeInfo = await findByteRangeStream(pdfPath);

        // Passo 2: Calcular ByteRange correto
        const fileStats = await fs.stat(pdfPath);
        const placeholderLengthWithBrackets = (byteRangeInfo.placeholderEnd + 1) - byteRangeInfo.placeholderStart;
        
        const byteRange = [0, 0, 0, 0];
        byteRange[1] = byteRangeInfo.placeholderStart;
        byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
        byteRange[3] = fileStats.size - byteRange[2];

        let actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
        actualByteRange += ' '.repeat(this.byteRangePlaceholder.length - actualByteRange.length);

        // Passo 3: Preparar certificado
        const { privateKey, certificate } = this._prepareCertificate(p12Buffer, options);

        // Passo 4: Calcular hash do conteúdo que será assinado
        const contentHash = await this._calculateContentHashStream(pdfPath, byteRange, actualByteRange, byteRangeInfo.byteRangePosition);

        // Passo 5: Criar assinatura PKCS#7
        const signature = this._createPKCS7Signature(contentHash, privateKey, certificate);

        // Verificar se assinatura cabe no placeholder
        if ((signature.length * 2) > byteRangeInfo.placeholderLength) {
            throw new SignPdfError(
                `Signature exceeds placeholder length: ${signature.length * 2} > ${byteRangeInfo.placeholderLength}`,
                SignPdfError.TYPE_INPUT,
            );
        }

        // Passo 6: Escrever arquivo final com assinatura
        await this._writeSignedPdfStream(pdfPath, outputPath, byteRange, actualByteRange, byteRangeInfo, signature);

        return outputPath;
    }

    /**
     * Prepara o certificado P12 para assinatura
     * @param {Buffer} p12Buffer 
     * @param {Object} options 
     * @returns {Object} privateKey e certificate
     */
    _prepareCertificate(p12Buffer, options) {
        // Converter Buffer P12 para implementação forge
        const forgeCert = forge.util.createBuffer(p12Buffer.toString('binary'));
        const p12Asn1 = forge.asn1.fromDer(forgeCert);
        const p12 = forge.pkcs12.pkcs12FromAsn1(
            p12Asn1,
            options.asn1StrictParsing,
            options.passphrase,
        );

        // Extrair certificados e chave privada
        const certBags = p12.getBags({
            bagType: forge.pki.oids.certBag,
        })[forge.pki.oids.certBag];
        const keyBags = p12.getBags({
            bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
        })[forge.pki.oids.pkcs8ShroudedKeyBag];

        const privateKey = keyBags[0].key;

        // Encontrar o certificado que corresponde à chave privada
        let certificate;
        Object.keys(certBags).forEach((i) => {
            const { publicKey } = certBags[i].cert;

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

        return { privateKey, certificate, certBags };
    }

    /**
     * Calcula hash SHA-256 do conteúdo que será assinado usando streams
     * @param {string} pdfPath 
     * @param {Array} byteRange 
     * @param {string} actualByteRange 
     * @param {number} byteRangePos 
     * @returns {Promise<Buffer>} Hash do conteúdo
     */
    async _calculateContentHashStream(pdfPath, byteRange, actualByteRange, byteRangePos) {
        const hash = createHash('sha256');
        
        return new Promise((resolve, reject) => {
            const stream = createReadStream(pdfPath);
            let currentPos = 0;
            let byteRangeReplaced = false;

            stream.on('data', (chunk) => {
                let processedChunk = chunk;

                // Substituir ByteRange placeholder se ainda não foi feito
                if (!byteRangeReplaced && currentPos <= byteRangePos && (currentPos + chunk.length) > byteRangePos) {
                    const localPos = byteRangePos - currentPos;
                    const placeholderLength = this.byteRangePlaceholder.length;
                    const replacementBuffer = Buffer.from(actualByteRange);
                    
                    processedChunk = Buffer.concat([
                        chunk.slice(0, localPos),
                        replacementBuffer,
                        chunk.slice(localPos + placeholderLength)
                    ]);
                    
                    byteRangeReplaced = true;
                }

                // Adicionar ao hash apenas as partes que devem ser assinadas (ByteRange)
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

    /**
     * Cria assinatura PKCS#7 para o hash do conteúdo
     * @param {Buffer} contentHash 
     * @param {Object} privateKey 
     * @param {Object} certificate 
     * @returns {Buffer} Assinatura em formato raw
     */
    _createPKCS7Signature(contentHash, privateKey, certificate) {
        // Criar estrutura PKCS#7
        const p7 = forge.pkcs7.createSignedData();
        
        // Definir conteúdo como hash (detached signature)
        p7.content = forge.util.createBuffer(contentHash);

        // Adicionar certificado
        p7.addCertificate(certificate);

        // Adicionar assinante com SHA-256
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
                    // valor será preenchido automaticamente
                },
            ],
        });

        // Assinar em modo detached
        p7.sign({ detached: true });

        const raw = forge.asn1.toDer(p7.toAsn1()).getBytes();
        return Buffer.from(raw, 'binary');
    }

    /**
     * Escreve o PDF final com a assinatura inserida usando streams
     * @param {string} inputPath 
     * @param {string} outputPath 
     * @param {Array} byteRange 
     * @param {string} actualByteRange 
     * @param {Object} byteRangeInfo 
     * @param {Buffer} signature 
     */
    async _writeSignedPdfStream(inputPath, outputPath, byteRange, actualByteRange, byteRangeInfo, signature) {
        // Converter assinatura para hex e preencher com zeros
        let hexSignature = signature.toString('hex');
        this.lastSignature = hexSignature;

        // Preencher com zeros até o tamanho do placeholder
        const paddingLength = (byteRangeInfo.placeholderLength / 2) - signature.length;
        if (paddingLength > 0) {
            hexSignature += '0'.repeat(paddingLength * 2);
        }

        const signatureWithBrackets = `<${hexSignature}>`;

        // Usar arquivo temporário se output é o mesmo que input
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

                // Substituir ByteRange placeholder
                if (!byteRangeReplaced && chunkStart <= byteRangeInfo.byteRangePosition && chunkEnd > byteRangeInfo.byteRangePosition) {
                    const localPos = byteRangeInfo.byteRangePosition - chunkStart;
                    const placeholderLength = this.byteRangePlaceholder.length;
                    const replacementBuffer = Buffer.from(actualByteRange);
                    
                    processedChunk = Buffer.concat([
                        chunk.slice(0, localPos),
                        replacementBuffer,
                        chunk.slice(localPos + placeholderLength)
                    ]);
                    
                    byteRangeReplaced = true;
                }

                // Inserir assinatura no lugar do placeholder
                if (!signatureInserted && chunkStart <= byteRange[1] && chunkEnd > byteRange[1]) {
                    const localPos = byteRange[1] - chunkStart;
                    
                    // Escrever até o placeholder
                    if (localPos > 0) {
                        writeStream.write(processedChunk.slice(0, localPos));
                    }
                    
                    // Escrever assinatura
                    writeStream.write(Buffer.from(signatureWithBrackets));
                    
                    // Pular o placeholder e continuar após ele
                    const skipLength = byteRange[2] - byteRange[1];
                    const remainingInChunk = processedChunk.length - localPos;
                    
                    if (remainingInChunk > skipLength) {
                        writeStream.write(processedChunk.slice(localPos + skipLength));
                    }
                    
                    signatureInserted = true;
                } else if (signatureInserted || chunkEnd <= byteRange[1] || chunkStart >= byteRange[2]) {
                    // Escrever chunk normal (fora da área do placeholder)
                    writeStream.write(processedChunk);
                }
                // Se estamos dentro da área do placeholder, pular (não escrever)

                currentPos += chunk.length;
            });

            readStream.on('end', async () => {
                writeStream.end();
                
                // Aguardar finalização da escrita
                writeStream.on('finish', async () => {
                    // Se usamos arquivo temporário, renomear
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