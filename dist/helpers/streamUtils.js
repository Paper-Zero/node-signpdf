"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findPatternInFile = exports.copyWithTransforms = exports.calculateFileHash = exports.calculateByteRangeHash = void 0;

var _fs = require("fs");

var _crypto = require("crypto");

var _promises = require("stream/promises");

/**
 * Calcula hash SHA-256 de um arquivo usando streams
 * @param {string} filePath - Caminho do arquivo
 * @returns {Promise<Buffer>} Hash SHA-256 do arquivo
 */
const calculateFileHash = async filePath => {
  const stream = (0, _fs.createReadStream)(filePath);
  const hash = (0, _crypto.createHash)('sha256');
  await (0, _promises.pipeline)(stream, hash);
  return hash.digest();
};
/**
 * Calcula hash SHA-256 de regiões específicas do arquivo (ByteRange)
 * @param {string} filePath - Caminho do arquivo
 * @param {number[]} byteRange - Array com [start1, length1, start2, length2]
 * @returns {Promise<Buffer>} Hash SHA-256 das regiões
 */


exports.calculateFileHash = calculateFileHash;

const calculateByteRangeHash = async (filePath, byteRange) => {
  const hash = (0, _crypto.createHash)('sha256'); // Ler primeira região

  if (byteRange[1] > 0) {
    const stream1 = (0, _fs.createReadStream)(filePath, {
      start: byteRange[0],
      end: byteRange[0] + byteRange[1] - 1
    });
    await new Promise((resolve, reject) => {
      stream1.on('data', chunk => hash.update(chunk));
      stream1.on('end', resolve);
      stream1.on('error', reject);
    });
  } // Ler segunda região


  if (byteRange[3] > 0) {
    const stream2 = (0, _fs.createReadStream)(filePath, {
      start: byteRange[2],
      end: byteRange[2] + byteRange[3] - 1
    });
    await new Promise((resolve, reject) => {
      stream2.on('data', chunk => hash.update(chunk));
      stream2.on('end', resolve);
      stream2.on('error', reject);
    });
  }

  return hash.digest();
};
/**
 * Encontra a posição de um padrão em um arquivo
 * @param {string} filePath - Caminho do arquivo
 * @param {Buffer|string} pattern - Padrão a procurar
 * @returns {Promise<number|null>} Posição do padrão ou null se não encontrado
 */


exports.calculateByteRangeHash = calculateByteRangeHash;

const findPatternInFile = async (filePath, pattern) => {
  const searchPattern = Buffer.isBuffer(pattern) ? pattern : Buffer.from(pattern);
  return new Promise((resolve, reject) => {
    const stream = (0, _fs.createReadStream)(filePath);
    let buffer = Buffer.alloc(0);
    let basePosition = 0;
    let found = false;
    stream.on('data', chunk => {
      if (found) return;
      buffer = Buffer.concat([buffer, chunk]);
      const index = buffer.indexOf(searchPattern);

      if (index !== -1) {
        found = true;
        stream.destroy();
        resolve(basePosition + index);
        return;
      } // Manter apenas os últimos bytes necessários para a busca


      const maxBufferSize = searchPattern.length + 1024;

      if (buffer.length > maxBufferSize) {
        const excessBytes = buffer.length - searchPattern.length + 1;
        basePosition += excessBytes;
        buffer = buffer.slice(excessBytes);
      }
    });
    stream.on('end', () => {
      if (!found) {
        resolve(null);
      }
    });
    stream.on('error', reject);
  });
};
/**
 * Copia arquivo aplicando transformações durante o streaming
 * @param {string} inputPath - Arquivo de entrada
 * @param {string} outputPath - Arquivo de saída
 * @param {Transform[]} transforms - Array de transforms para aplicar
 * @returns {Promise<void>}
 */


exports.findPatternInFile = findPatternInFile;

const copyWithTransforms = async (inputPath, outputPath, transforms = []) => {
  const readStream = (0, _fs.createReadStream)(inputPath);
  const writeStream = (0, _fs.createWriteStream)(outputPath); // Encadear transforms

  let currentStream = readStream;
  transforms.forEach(transform => {
    currentStream = currentStream.pipe(transform);
  });
  await (0, _promises.pipeline)(currentStream, writeStream);
};

exports.copyWithTransforms = copyWithTransforms;