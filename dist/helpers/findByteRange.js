"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _SignPdfError = _interopRequireDefault(require("../SignPdfError"));

var _const = require("./const");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Finds ByteRange information within a given PDF Buffer if one exists
 *
 * @param {Buffer} pdf
 * @returns {Object} {byteRangePlaceholder: String, byteRangeStrings: String[], byteRange: String[]}
 */
const findByteRange = pdf => {
  if (!(pdf instanceof Buffer)) {
    throw new _SignPdfError.default('PDF expected as Buffer.', _SignPdfError.default.TYPE_INPUT);
  } // Criar regex dinâmico baseado no tamanho real do placeholder


  const placeholderLength = _const.DEFAULT_BYTE_RANGE_PLACEHOLDER.length;
  const byteRangeRegex = new RegExp(`\\/ByteRange\\s*\\[{1}\\s*(?:(?:\\d*|\\/\\*{${placeholderLength}})\\s+){3}(?:\\d+|\\/\\*{${placeholderLength}}){1}\\s*]{1}`, 'g');
  const byteRangeStrings = pdf.toString().match(byteRangeRegex);

  if (!byteRangeStrings) {
    throw new _SignPdfError.default('No ByteRangeStrings found within PDF buffer', _SignPdfError.default.TYPE_PARSE);
  }

  const byteRangePlaceholder = byteRangeStrings.find(s => s.includes(`/${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`));
  const byteRangeRegexForParsing = new RegExp(`[^[\\s]*(?:\\d|\\/\\*{${placeholderLength}})`, 'g');
  const byteRanges = byteRangeStrings.map(brs => brs.match(byteRangeRegexForParsing));
  return {
    byteRangePlaceholder,
    byteRangeStrings,
    byteRanges
  };
};

var _default = findByteRange;
exports.default = _default;