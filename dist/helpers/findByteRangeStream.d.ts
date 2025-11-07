export function findByteRangeStream(pdfPath: string): Promise<any>;
export function findByteRangeStringsStream(pdfPath: string): Promise<any>;
export default findByteRange;
/**
 * Wrapper que mantém compatibilidade com a API original
 * Usa streams internamente mas aceita Buffer para compatibilidade
 * @param {Buffer|string} pdf - Buffer do PDF ou caminho do arquivo
 * @returns {Object|Promise<Object>} Informações do ByteRange
 */
declare function findByteRange(pdf: Buffer | string): any | Promise<any>;
//# sourceMappingURL=findByteRangeStream.d.ts.map