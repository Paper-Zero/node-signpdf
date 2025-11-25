import SignPdfError from '../SignPdfError';
import {DEFAULT_BYTE_RANGE_PLACEHOLDER} from './const';

/**
 * Finds ByteRange information within a given PDF Buffer if one exists
 *
 * @param {Buffer} pdf
 * @returns {Object} {byteRangePlaceholder: String, byteRangeStrings: String[], byteRange: String[]}
 */
const findByteRange = (pdf) => {
    if (!(pdf instanceof Buffer)) {
        throw new SignPdfError(
            'PDF expected as Buffer.',
            SignPdfError.TYPE_INPUT,
        );
    }

    // Criar regex dinâmico baseado no tamanho real do placeholder
    const placeholderLength = DEFAULT_BYTE_RANGE_PLACEHOLDER.length;
    const byteRangeRegex = new RegExp(`\\/ByteRange\\s*\\[{1}\\s*(?:(?:\\d*|\\/\\*{${placeholderLength}})\\s+){3}(?:\\d+|\\/\\*{${placeholderLength}}){1}\\s*]{1}`, 'g');
    const byteRangeStrings = pdf.toString().match(byteRangeRegex);

    if (!byteRangeStrings) {
        throw new SignPdfError(
            'No ByteRangeStrings found within PDF buffer',
            SignPdfError.TYPE_PARSE,
        );
    }

    const byteRangePlaceholder = byteRangeStrings.find((s) => s.includes(`/${DEFAULT_BYTE_RANGE_PLACEHOLDER}`));
    const byteRangeRegexForParsing = new RegExp(`[^[\\s]*(?:\\d|\\/\\*{${placeholderLength}})`, 'g');
    const byteRanges = byteRangeStrings.map((brs) => brs.match(byteRangeRegexForParsing));

    return {
        byteRangePlaceholder,
        byteRangeStrings,
        byteRanges,
    };
};

export default findByteRange;
