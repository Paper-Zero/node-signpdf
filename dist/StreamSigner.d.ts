/**
 * StreamSigner - Version streaming do node-signpdf que elimina o limite de 2GB
 * Permite assinar PDFs de qualquer tamanho usando streams para consumo mínimo de memória
 */
export class StreamSigner {
    byteRangePlaceholder: string;
    lastSignature: string;
    /**
     * Assina um PDF usando streaming para suportar arquivos grandes
     * @param {string} pdfPath - Caminho para o arquivo PDF
     * @param {Buffer} p12Buffer - Certificado P12/PFX como Buffer
     * @param {Object} additionalOptions - Opções adicionais
     * @returns {Promise<string>} Caminho do arquivo assinado
     */
    sign(pdfPath: string, p12Buffer: Buffer, additionalOptions?: any): Promise<string>;
    /**
     * Prepara o certificado P12 para assinatura
     * @param {Buffer} p12Buffer
     * @param {Object} options
     * @returns {Object} privateKey e certificate
     */
    _prepareCertificate(p12Buffer: Buffer, options: any): any;
    /**
     * Calcula hash SHA-256 do conteúdo que será assinado usando streams
     * @param {string} pdfPath
     * @param {Array} byteRange
     * @param {string} actualByteRange
     * @param {number} byteRangePos
     * @returns {Promise<Buffer>} Hash do conteúdo
     */
    _calculateContentHashStream(pdfPath: string, byteRange: any[], actualByteRange: string, byteRangePos: number): Promise<Buffer>;
    /**
     * Cria assinatura PKCS#7 para o hash do conteúdo
     * @param {Buffer} contentHash
     * @param {Object} privateKey
     * @param {Object} certificate
     * @returns {Buffer} Assinatura em formato raw
     */
    _createPKCS7Signature(contentHash: Buffer, privateKey: any, certificate: any): Buffer;
    /**
     * Escreve o PDF final com a assinatura inserida usando streams
     * @param {string} inputPath
     * @param {string} outputPath
     * @param {Array} byteRange
     * @param {string} actualByteRange
     * @param {Object} byteRangeInfo
     * @param {Buffer} signature
     */
    _writeSignedPdfStream(inputPath: string, outputPath: string, byteRange: any[], actualByteRange: string, byteRangeInfo: any, signature: Buffer): Promise<any>;
}
declare const _default: StreamSigner;
export default _default;
//# sourceMappingURL=StreamSigner.d.ts.map