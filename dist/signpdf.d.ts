export { default as SignPdfError } from "./SignPdfError";
export * from "./helpers";
export * from "./helpers/const";
export { StreamSigner } from "./StreamSigner";
export { default as streamAddPlaceholder } from "./helpers/streamAddPlaceholder";
export class SignPdf {
    byteRangePlaceholder: string;
    lastSignature: string;
    sign(pdfBuffer: any, p12Buffer: any, additionalOptions?: {}): Buffer;
}
declare const _default: SignPdf;
export default _default;
//# sourceMappingURL=signpdf.d.ts.map