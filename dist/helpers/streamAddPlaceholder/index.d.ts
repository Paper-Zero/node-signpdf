export default streamAddPlaceholder;
/**
 * Adiciona um placeholder de assinatura ao PDF usando streams
 * Evita carregar o arquivo inteiro na memória
 */
declare function streamAddPlaceholder({ pdfPath, outputPath, reason, contactInfo, name, location, signatureLength, subFilter, }: {
    pdfPath: any;
    outputPath?: any;
    reason?: string;
    contactInfo?: string;
    name?: string;
    location?: string;
    signatureLength?: number;
    subFilter?: string;
}): Promise<any>;
//# sourceMappingURL=index.d.ts.map