"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.StreamSigner = void 0;

var _nodeForge = _interopRequireDefault(require("node-forge"));

var _fs = require("fs");

var _crypto = require("crypto");

var _promises = require("stream/promises");

var _SignPdfError = _interopRequireDefault(require("./SignPdfError"));

var _helpers = require("./helpers");

var _const = require("./helpers/const");

var _findByteRangeStream = require("./helpers/findByteRangeStream");

var _streamUtils = require("./helpers/streamUtils");

var _streamAddPlaceholder = _interopRequireDefault(require("./helpers/streamAddPlaceholder"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * StreamSigner - Version streaming do node-signpdf que elimina o limite de 2GB
 * Permite assinar PDFs de qualquer tamanho usando streams para consumo mínimo de memória
 */
class StreamSigner {
  constructor() {
    this.byteRangePlaceholder = _const.DEFAULT_BYTE_RANGE_PLACEHOLDER;
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
      outputPath: null,
      // Se null, sobrescreve o arquivo original
      ...additionalOptions
    }; // Validações básicas

    if (typeof pdfPath !== 'string') {
      throw new _SignPdfError.default('PDF path expected as string.', _SignPdfError.default.TYPE_INPUT);
    }

    if (!(p12Buffer instanceof Buffer)) {
      throw new _SignPdfError.default('p12 certificate expected as Buffer.', _SignPdfError.default.TYPE_INPUT);
    } // Verifica se o arquivo existe


    try {
      await _fs.promises.access(pdfPath);
    } catch (error) {
      throw new _SignPdfError.default(`PDF file not found: ${pdfPath}`, _SignPdfError.default.TYPE_INPUT);
    }

    const outputPath = options.outputPath || pdfPath; // Passo 1: Encontrar ByteRange placeholder no PDF usando stream

    const byteRangeInfo = await (0, _findByteRangeStream.findByteRangeStream)(pdfPath); // Passo 2: Calcular ByteRange correto

    const fileStats = await _fs.promises.stat(pdfPath);
    const placeholderLengthWithBrackets = byteRangeInfo.placeholderEnd + 1 - byteRangeInfo.placeholderStart;
    const byteRange = [0, 0, 0, 0];
    byteRange[1] = byteRangeInfo.placeholderStart;
    byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
    byteRange[3] = fileStats.size - byteRange[2];
    let actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
    actualByteRange += ' '.repeat(this.byteRangePlaceholder.length - actualByteRange.length); // Passo 3: Preparar certificado

    const {
      privateKey,
      certificate
    } = this._prepareCertificate(p12Buffer, options); // Passo 4: Calcular hash do conteúdo que será assinado


    const contentHash = await this._calculateContentHashStream(pdfPath, byteRange, actualByteRange, byteRangeInfo.byteRangePosition); // Passo 5: Criar assinatura PKCS#7

    const signature = this._createPKCS7Signature(contentHash, privateKey, certificate); // Verificar se assinatura cabe no placeholder


    if (signature.length * 2 > byteRangeInfo.placeholderLength) {
      throw new _SignPdfError.default(`Signature exceeds placeholder length: ${signature.length * 2} > ${byteRangeInfo.placeholderLength}`, _SignPdfError.default.TYPE_INPUT);
    } // Passo 6: Escrever arquivo final com assinatura


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
    const forgeCert = _nodeForge.default.util.createBuffer(p12Buffer.toString('binary'));

    const p12Asn1 = _nodeForge.default.asn1.fromDer(forgeCert);

    const p12 = _nodeForge.default.pkcs12.pkcs12FromAsn1(p12Asn1, options.asn1StrictParsing, options.passphrase); // Extrair certificados e chave privada


    const certBags = p12.getBags({
      bagType: _nodeForge.default.pki.oids.certBag
    })[_nodeForge.default.pki.oids.certBag];

    const keyBags = p12.getBags({
      bagType: _nodeForge.default.pki.oids.pkcs8ShroudedKeyBag
    })[_nodeForge.default.pki.oids.pkcs8ShroudedKeyBag];

    const privateKey = keyBags[0].key; // Encontrar o certificado que corresponde à chave privada

    let certificate;
    Object.keys(certBags).forEach(i => {
      const {
        publicKey
      } = certBags[i].cert;

      if (privateKey.n.compareTo(publicKey.n) === 0 && privateKey.e.compareTo(publicKey.e) === 0) {
        certificate = certBags[i].cert;
      }
    });

    if (typeof certificate === 'undefined') {
      throw new _SignPdfError.default('Failed to find a certificate that matches the private key.', _SignPdfError.default.TYPE_INPUT);
    }

    return {
      privateKey,
      certificate,
      certBags
    };
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
    const hash = (0, _crypto.createHash)('sha256');
    return new Promise((resolve, reject) => {
      const stream = (0, _fs.createReadStream)(pdfPath);
      let currentPos = 0;
      let byteRangeReplaced = false;
      stream.on('data', chunk => {
        let processedChunk = chunk; // Substituir ByteRange placeholder se ainda não foi feito

        if (!byteRangeReplaced && currentPos <= byteRangePos && currentPos + chunk.length > byteRangePos) {
          const localPos = byteRangePos - currentPos;
          const placeholderLength = this.byteRangePlaceholder.length;
          const replacementBuffer = Buffer.from(actualByteRange);
          processedChunk = Buffer.concat([chunk.slice(0, localPos), replacementBuffer, chunk.slice(localPos + placeholderLength)]);
          byteRangeReplaced = true;
        } // Adicionar ao hash apenas as partes que devem ser assinadas (ByteRange)


        const chunkStart = currentPos;
        const chunkEnd = currentPos + processedChunk.length; // Primeira parte: do início até o placeholder da assinatura

        if (chunkStart < byteRange[1]) {
          const endPos = Math.min(chunkEnd, byteRange[1]);
          const sliceEnd = endPos - chunkStart;
          hash.update(processedChunk.slice(0, sliceEnd));
        } // Segunda parte: após o placeholder da assinatura até o final


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
    const p7 = _nodeForge.default.pkcs7.createSignedData(); // Definir conteúdo como hash (detached signature)


    p7.content = _nodeForge.default.util.createBuffer(contentHash); // Adicionar certificado

    p7.addCertificate(certificate); // Adicionar assinante com SHA-256

    p7.addSigner({
      key: privateKey,
      certificate,
      digestAlgorithm: _nodeForge.default.pki.oids.sha256,
      authenticatedAttributes: [{
        type: _nodeForge.default.pki.oids.contentType,
        value: _nodeForge.default.pki.oids.data
      }, {
        type: _nodeForge.default.pki.oids.signingTime,
        value: new Date()
      }, {
        type: _nodeForge.default.pki.oids.messageDigest // valor será preenchido automaticamente

      }]
    }); // Assinar em modo detached

    p7.sign({
      detached: true
    });

    const raw = _nodeForge.default.asn1.toDer(p7.toAsn1()).getBytes();

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
    this.lastSignature = hexSignature; // Preencher com zeros até o tamanho do placeholder

    const paddingLength = byteRangeInfo.placeholderLength / 2 - signature.length;

    if (paddingLength > 0) {
      hexSignature += '0'.repeat(paddingLength * 2);
    }

    const signatureWithBrackets = `<${hexSignature}>`; // Usar arquivo temporário se output é o mesmo que input

    const tempPath = outputPath === inputPath ? `${outputPath}.tmp` : outputPath;
    const readStream = (0, _fs.createReadStream)(inputPath);
    const writeStream = (0, _fs.createWriteStream)(tempPath);
    let currentPos = 0;
    let byteRangeReplaced = false;
    let signatureInserted = false;
    return new Promise((resolve, reject) => {
      readStream.on('data', chunk => {
        let processedChunk = chunk;
        const chunkStart = currentPos;
        const chunkEnd = currentPos + chunk.length; // Substituir ByteRange placeholder

        if (!byteRangeReplaced && chunkStart <= byteRangeInfo.byteRangePosition && chunkEnd > byteRangeInfo.byteRangePosition) {
          const localPos = byteRangeInfo.byteRangePosition - chunkStart;
          const placeholderLength = this.byteRangePlaceholder.length;
          const replacementBuffer = Buffer.from(actualByteRange);
          processedChunk = Buffer.concat([chunk.slice(0, localPos), replacementBuffer, chunk.slice(localPos + placeholderLength)]);
          byteRangeReplaced = true;
        } // Inserir assinatura no lugar do placeholder


        if (!signatureInserted && chunkStart <= byteRange[1] && chunkEnd > byteRange[1]) {
          const localPos = byteRange[1] - chunkStart; // Escrever até o placeholder

          if (localPos > 0) {
            writeStream.write(processedChunk.slice(0, localPos));
          } // Escrever assinatura


          writeStream.write(Buffer.from(signatureWithBrackets)); // Pular o placeholder e continuar após ele

          const skipLength = byteRange[2] - byteRange[1];
          const remainingInChunk = processedChunk.length - localPos;

          if (remainingInChunk > skipLength) {
            writeStream.write(processedChunk.slice(localPos + skipLength));
          }

          signatureInserted = true;
        } else if (signatureInserted || chunkEnd <= byteRange[1] || chunkStart >= byteRange[2]) {
          // Escrever chunk normal (fora da área do placeholder)
          writeStream.write(processedChunk);
        } // Se estamos dentro da área do placeholder, pular (não escrever)


        currentPos += chunk.length;
      });
      readStream.on('end', async () => {
        writeStream.end(); // Aguardar finalização da escrita

        writeStream.on('finish', async () => {
          // Se usamos arquivo temporário, renomear
          if (tempPath !== outputPath) {
            try {
              await _fs.promises.rename(tempPath, outputPath);
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

exports.StreamSigner = StreamSigner;

var _default = new StreamSigner();

exports.default = _default;