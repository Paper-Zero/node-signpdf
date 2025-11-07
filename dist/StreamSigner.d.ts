/**
 * StreamSigner - Version streaming do node-signpdf que elimina o limite de 2GB
 * Permite assinar PDFs de qualquer tamanho usando streams para consumo mínimo de memória
 */
export class StreamSigner {
    byteRangePlaceholder: string;
    lastSignature: any;
    /**
     * Assina um PDF usando streaming para suportar arquivos grandes
     * @param {string} pdfPath - Caminho para o arquivo PDF
     * @param {Buffer} p12Buffer - Certificado P12/PFX como Buffer
     * @param {Object} additionalOptions - Opções adicionais
     * @returns {Promise<string>} Caminho do arquivo assinado
     */
    sign(pdfPath: string, p12Buffer: Buffer, additionalOptions?: any): Promise<string>;
    validateInputs(pdfPath: any, p12Buffer: any): void;
    checkFileExists(pdfPath: any): Promise<void>;
    calculateByteRange(pdfPath: any, byteRangeInfo: any): Promise<number[]>;
    formatByteRange(byteRange: any): string;
    prepareCertificate(p12Buffer: any, options: any): {
        privateKey: any;
        certificate: never;
    };
    calculateContentHash(pdfPath: any, byteRange: any, actualByteRange: any, byteRangePos: any): Promise<any>;
    createPKCS7Signature(contentHash: any, privateKey: any, certificate: any): Buffer;
    validateSignatureSize(signature: any, placeholderLength: any): void;
    writeSignedPdf(inputPath: any, outputPath: any, byteRange: any, actualByteRange: any, byteRangeInfo: any, signature: any): Promise<any>;
}
declare const _default: StreamSigner;
export default _default;
//# sourceMappingURL=StreamSigner.d.ts.map