"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findByteRangeStringsStream = exports.findByteRangeStream = exports.default = void 0;

var _fs = require("fs");

var _SignPdfError = _interopRequireDefault(require("../SignPdfError"));

var _const = require("./const");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Encontra informações do ByteRange em um PDF usando streams
 * Versão otimizada que não carrega o arquivo inteiro na memória
 * @param {string} pdfPath - Caminho do arquivo PDF
 * @returns {Promise<Object>}
 * {byteRangePlaceholder, byteRangePosition, contentsPosition, placeholderPosition}
 */
const findByteRangeStream = async pdfPath => {
  if (typeof pdfPath !== 'string') {
    throw new _SignPdfError.default('PDF path expected as string.', _SignPdfError.default.TYPE_INPUT);
  }

  return new Promise((resolve, reject) => {
    const stream = (0, _fs.createReadStream)(pdfPath);
    let buffer = Buffer.alloc(0);
    let currentPosition = 0;
    let found = false;
    const placeholderPattern = Buffer.from(`/ByteRange [${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}]`);
    const contentsPattern = Buffer.from('/Contents ');
    const openBracketPattern = Buffer.from('<');
    const closeBracketPattern = Buffer.from('>');
    stream.on('data', chunk => {
      if (found) return;
      buffer = Buffer.concat([buffer, chunk]); // Procurar pelo placeholder do ByteRange

      const placeholderIndex = buffer.indexOf(placeholderPattern);

      if (placeholderIndex !== -1) {
        const absolutePlaceholderPos = currentPosition + placeholderIndex; // Procurar por /Contents após o ByteRange

        const contentsIndex = buffer.indexOf(contentsPattern, placeholderIndex);

        if (contentsIndex !== -1) {
          const absoluteContentsPos = currentPosition + contentsIndex; // Procurar pelos brackets do placeholder de assinatura

          const openBracketIndex = buffer.indexOf(openBracketPattern, contentsIndex);
          const closeBracketIndex = buffer.indexOf(closeBracketPattern, openBracketIndex);

          if (openBracketIndex !== -1 && closeBracketIndex !== -1) {
            const absoluteOpenPos = currentPosition + openBracketIndex;
            const absoluteClosePos = currentPosition + closeBracketIndex;
            found = true;
            stream.destroy();
            resolve({
              byteRangePlaceholder: _const.DEFAULT_BYTE_RANGE_PLACEHOLDER,
              byteRangePosition: absolutePlaceholderPos,
              contentsPosition: absoluteContentsPos,
              placeholderStart: absoluteOpenPos,
              placeholderEnd: absoluteClosePos,
              // -1 para excluir os brackets
              placeholderLength: absoluteClosePos - absoluteOpenPos - 1
            });
            return;
          }
        }
      }

      currentPosition += chunk.length; // Manter buffer limitado mas preservar dados suficientes para busca

      const maxBufferSize = 2048;

      if (buffer.length > maxBufferSize) {
        const keepSize = 1024;
        currentPosition -= buffer.length - keepSize;
        buffer = buffer.slice(-keepSize);
      }
    });
    stream.on('end', () => {
      if (!found) {
        reject(new _SignPdfError.default(`Could not find empty ByteRange placeholder: ${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`, _SignPdfError.default.TYPE_PARSE));
      }
    });
    stream.on('error', reject);
  });
};
/**
 * Encontra múltiplas strings de ByteRange em um PDF usando streams
 * Compatível com a implementação original
 * @param {string} pdfPath - Caminho do arquivo PDF
 * @returns {Promise<Object>} {byteRangeStrings, byteRangePlaceholder, byteRanges}
 */


exports.findByteRangeStream = findByteRangeStream;

const findByteRangeStringsStream = async pdfPath => new Promise((resolve, reject) => {
  const stream = (0, _fs.createReadStream)(pdfPath);
  let content = '';
  stream.on('data', chunk => {
    content += chunk.toString('latin1'); // Limitar o tamanho do conteúdo acumulado para evitar estouro de memória
    // Manter apenas o suficiente para busca de padrões

    if (content.length > 10240) {
      // 10KB
      const keepSize = 5120; // manter últimos 5KB

      content = content.slice(-keepSize);
    }
  });
  stream.on('end', () => {
    try {
      const byteRangeStrings = content.match(/\/ByteRange\s*\[{1}\s*(?:(?:\d*|\/\*{10})\s+){3}(?:\d+|\/\*{10}){1}\s*]{1}/g);

      if (!byteRangeStrings) {
        reject(new _SignPdfError.default('No ByteRangeStrings found within PDF', _SignPdfError.default.TYPE_PARSE));
        return;
      }

      const byteRangePlaceholder = byteRangeStrings.find(s => s.includes(`/${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`));
      const byteRanges = byteRangeStrings.map(brs => brs.match(/[^[\s]*(?:\d|\/\*{10})/g));
      resolve({
        byteRangeStrings,
        byteRangePlaceholder,
        byteRanges
      });
    } catch (error) {
      reject(error);
    }
  });
  stream.on('error', reject);
});
/**
 * Wrapper que mantém compatibilidade com a API original
 * Usa streams internamente mas aceita Buffer para compatibilidade
 * @param {Buffer|string} pdf - Buffer do PDF ou caminho do arquivo
 * @returns {Object|Promise<Object>} Informações do ByteRange
 */


exports.findByteRangeStringsStream = findByteRangeStringsStream;

const findByteRange = pdf => {
  if (pdf instanceof Buffer) {
    // Modo compatibilidade: usar implementação original para Buffer
    const content = pdf.toString('latin1');
    const byteRangeStrings = content.match(/\/ByteRange\s*\[{1}\s*(?:(?:\d*|\/\*{10})\s+){3}(?:\d+|\/\*{10}){1}\s*]{1}/g);

    if (!byteRangeStrings) {
      throw new _SignPdfError.default('No ByteRangeStrings found within PDF buffer', _SignPdfError.default.TYPE_PARSE);
    }

    const byteRangePlaceholder = byteRangeStrings.find(s => s.includes(`/${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`));
    const byteRanges = byteRangeStrings.map(brs => brs.match(/[^[\s]*(?:\d|\/\*{10})/g));
    return {
      byteRangeStrings,
      byteRangePlaceholder,
      byteRanges
    };
  }

  if (typeof pdf === 'string') {
    // Modo streaming: usar nova implementação
    return findByteRangeStringsStream(pdf);
  }

  throw new _SignPdfError.default('PDF expected as Buffer or file path string.', _SignPdfError.default.TYPE_INPUT);
};

var _default = findByteRange;
exports.default = _default;