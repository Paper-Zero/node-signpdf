"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.StreamSigner = void 0;

var _fs = _interopRequireWildcard(require("fs"));

var _crypto = require("crypto");

var _nodeForge = _interopRequireDefault(require("node-forge"));

var _SignPdfError = _interopRequireDefault(require("./SignPdfError"));

var _const = require("./helpers/const");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }

function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

const {
  open,
  stat
} = _fs.promises;
const BYTE_RANGE_MARKER = Buffer.from('/ByteRange [');
const CONTENTS_MARKER = Buffer.from('/Contents ');
const OPEN_ANGLE = 0x3c; // '<'

const CLOSE_ANGLE = 0x3e; // '>'

class ByteRangeFinder {
  constructor() {
    this.byteRangePos = -1;
    this.byteRangeEnd = -1;
    this.contentsPos = -1;
    this.placeholderPos = -1;
    this.placeholderEnd = -1;
    this.byteRangeLength = null;
    this._buffer = Buffer.alloc(0);
    this._bufferOffset = 0;
  }

  push(chunk, offset) {
    if (this._buffer.length === 0) {
      this._buffer = chunk;
      this._bufferOffset = offset;
    } else {
      this._buffer = Buffer.concat([this._buffer, chunk]);
    }

    this._search();

    this._trim();
  }

  _search() {
    const base = this._bufferOffset;
    const buf = this._buffer;

    if (this.byteRangePos === -1) {
      const idx = buf.indexOf(BYTE_RANGE_MARKER);

      if (idx !== -1) {
        this.byteRangePos = base + idx;
      }
    }

    if (this.byteRangePos !== -1 && this.byteRangeEnd === -1) {
      const relativeStart = Math.max(0, this.byteRangePos - base);
      const closeIdx = buf.indexOf(']'.charCodeAt(0), relativeStart);

      if (closeIdx !== -1) {
        this.byteRangeEnd = base + closeIdx + 1;
        this.byteRangeLength = this.byteRangeEnd - this.byteRangePos;
      }
    }

    if (this.byteRangeEnd !== -1 && this.contentsPos === -1) {
      const relativeStart = Math.max(0, this.byteRangeEnd - base);
      const idx = buf.indexOf(CONTENTS_MARKER, relativeStart);

      if (idx !== -1) {
        this.contentsPos = base + idx;
      }
    }

    if (this.contentsPos !== -1 && this.placeholderPos === -1) {
      const relativeStart = Math.max(0, this.contentsPos - base);
      const ltIdx = buf.indexOf(OPEN_ANGLE, relativeStart);

      if (ltIdx !== -1) {
        this.placeholderPos = base + ltIdx;
      }
    }

    if (this.placeholderPos !== -1 && this.placeholderEnd === -1) {
      const relativeStart = Math.max(0, this.placeholderPos - base + 1);
      const gtIdx = buf.indexOf(CLOSE_ANGLE, relativeStart);

      if (gtIdx !== -1) {
        this.placeholderEnd = base + gtIdx;
      }
    }
  }

  _trim() {
    const MAX_BUFFER = 1024 * 1024; // keep last 1MB

    if (this._buffer.length > MAX_BUFFER) {
      const drop = this._buffer.length - MAX_BUFFER;
      this._buffer = this._buffer.slice(drop);
      this._bufferOffset += drop;
    }
  }

  get placeholderLengthWithBrackets() {
    if (this.placeholderPos === -1 || this.placeholderEnd === -1) {
      return null;
    }

    return this.placeholderEnd - this.placeholderPos + 1;
  }

  get isComplete() {
    return this.byteRangePos !== -1 && this.byteRangeEnd !== -1 && this.contentsPos !== -1 && this.placeholderPos !== -1 && this.placeholderEnd !== -1;
  }

}

class StreamSigner {
  constructor() {
    this.byteRangePlaceholder = _const.DEFAULT_BYTE_RANGE_PLACEHOLDER;
    this.lastSignature = null;
  }

  async sign(pdfPath, p12Buffer, additionalOptions = {}) {
    const options = {
      asn1StrictParsing: false,
      passphrase: '',
      ...additionalOptions
    };

    if (typeof pdfPath !== 'string') {
      throw new _SignPdfError.default('PDF path expected as a string.', _SignPdfError.default.TYPE_INPUT);
    }

    if (!(p12Buffer instanceof Buffer)) {
      throw new _SignPdfError.default('p12 certificate expected as Buffer.', _SignPdfError.default.TYPE_INPUT);
    }

    const fileStats = await stat(pdfPath);

    if (!fileStats.isFile()) {
      throw new _SignPdfError.default('PDF path must point to a file.', _SignPdfError.default.TYPE_INPUT);
    }

    const finder = new ByteRangeFinder();
    const hash = (0, _crypto.createHash)('sha256');
    let offset = 0;
    let skipStart = null;
    let skipEnd = null;
    let skipping = false;

    const stream = _fs.default.createReadStream(pdfPath, {
      highWaterMark: 64 * 1024
    });

    for await (const chunk of stream) {
      finder.push(chunk, offset);

      if (finder.placeholderPos !== -1 && skipStart === null) {
        skipStart = finder.placeholderPos;
      }

      if (finder.placeholderEnd !== -1) {
        skipEnd = finder.placeholderEnd + 1;
      }

      const chunkStart = offset;
      const chunkEnd = offset + chunk.length;
      let cursor = 0;

      const updateHash = (start, end) => {
        if (end > start) {
          hash.update(chunk.subarray(start, end));
        }
      };

      if (skipStart === null || chunkEnd <= skipStart) {
        updateHash(0, chunk.length);
      } else {
        if (!skipping && chunkStart < skipStart) {
          const endBeforeSkip = Math.min(chunk.length, skipStart - chunkStart);
          updateHash(0, endBeforeSkip);
          cursor = endBeforeSkip;
          skipping = true;
        }

        if (skipping) {
          if (skipEnd !== null && skipEnd <= chunkStart) {
            skipping = false;
          } else if (skipEnd !== null && skipEnd <= chunkEnd) {
            const skipEndInChunk = skipEnd - chunkStart;
            cursor = Math.max(cursor, skipEndInChunk);
            skipping = false;
          } else {
            cursor = chunk.length;
          }
        }

        if (!skipping && cursor < chunk.length) {
          updateHash(cursor, chunk.length);
        }
      }

      offset += chunk.length;
    }

    if (!finder.isComplete) {
      throw new _SignPdfError.default('Could not determine ByteRange placeholder.', _SignPdfError.default.TYPE_PARSE);
    }

    if (skipStart === null || skipEnd === null) {
      throw new _SignPdfError.default('Signature placeholder not found.', _SignPdfError.default.TYPE_PARSE);
    }

    if (typeof finder.byteRangeLength !== 'number') {
      throw new _SignPdfError.default('Invalid ByteRange placeholder length.', _SignPdfError.default.TYPE_PARSE);
    }

    const hashDigest = hash.digest();
    const fileHandle = await open(pdfPath, 'r+');

    try {
      const byteRangeBuffer = Buffer.alloc(finder.byteRangeLength);
      await fileHandle.read(byteRangeBuffer, 0, finder.byteRangeLength, finder.byteRangePos);
      const byteRangeString = byteRangeBuffer.toString();

      if (!byteRangeString.includes(`/${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`)) {
        throw new _SignPdfError.default(`Could not find empty ByteRange placeholder: ${_const.DEFAULT_BYTE_RANGE_PLACEHOLDER}`, _SignPdfError.default.TYPE_PARSE);
      }

      const placeholderLengthWithBrackets = finder.placeholderLengthWithBrackets;
      const placeholderLength = placeholderLengthWithBrackets - 2;
      const byteRange = [0, 0, 0, 0];
      byteRange[1] = finder.placeholderPos;
      byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
      byteRange[3] = fileStats.size - byteRange[2];
      let actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
      actualByteRange += ' '.repeat(finder.byteRangeLength - actualByteRange.length);

      const forgeCert = _nodeForge.default.util.createBuffer(p12Buffer.toString('binary'));

      const p12Asn1 = _nodeForge.default.asn1.fromDer(forgeCert);

      const p12 = _nodeForge.default.pkcs12.pkcs12FromAsn1(p12Asn1, options.asn1StrictParsing, options.passphrase);

      const certBags = p12.getBags({
        bagType: _nodeForge.default.pki.oids.certBag
      })[_nodeForge.default.pki.oids.certBag];

      const keyBags = p12.getBags({
        bagType: _nodeForge.default.pki.oids.pkcs8ShroudedKeyBag
      })[_nodeForge.default.pki.oids.pkcs8ShroudedKeyBag];

      const privateKey = keyBags[0].key;

      const p7 = _nodeForge.default.pkcs7.createSignedData();

      p7.content = _nodeForge.default.util.createBuffer('');
      let certificate;
      Object.keys(certBags).forEach(i => {
        const {
          publicKey
        } = certBags[i].cert;
        p7.addCertificate(certBags[i].cert);

        if (privateKey.n.compareTo(publicKey.n) === 0 && privateKey.e.compareTo(publicKey.e) === 0) {
          certificate = certBags[i].cert;
        }
      });

      if (typeof certificate === 'undefined') {
        throw new _SignPdfError.default('Failed to find a certificate that matches the private key.', _SignPdfError.default.TYPE_INPUT);
      }

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
          type: _nodeForge.default.pki.oids.messageDigest
        }]
      });
      const originalSha256Create = _nodeForge.default.md.sha256.create;
      const digestBinary = hashDigest.toString('binary');

      _nodeForge.default.md.sha256.create = () => {
        const md = originalSha256Create.call(_nodeForge.default.md.sha256);

        md.start = () => md;

        md.update = () => md;

        md.digest = () => _nodeForge.default.util.createBuffer(digestBinary);

        return md;
      };

      try {
        p7.sign({
          detached: true
        });
      } finally {
        _nodeForge.default.md.sha256.create = originalSha256Create;
      }

      const raw = _nodeForge.default.asn1.toDer(p7.toAsn1()).getBytes();

      if (raw.length * 2 > placeholderLength) {
        throw new _SignPdfError.default(`Signature exceeds placeholder length: ${raw.length * 2} > ${placeholderLength}`, _SignPdfError.default.TYPE_INPUT);
      }

      let signature = Buffer.from(raw, 'binary').toString('hex');
      this.lastSignature = signature;
      signature += Buffer.from(String.fromCharCode(0).repeat(placeholderLength / 2 - raw.length)).toString('hex');
      const byteRangeBufferReplacement = Buffer.from(actualByteRange);
      await fileHandle.write(byteRangeBufferReplacement, 0, byteRangeBufferReplacement.length, finder.byteRangePos);
      const signatureBuffer = Buffer.from(`<${signature}>`);
      await fileHandle.write(signatureBuffer, 0, signatureBuffer.length, finder.placeholderPos);
    } finally {
      await fileHandle.close();
    }

    return undefined;
  }

}

exports.StreamSigner = StreamSigner;

var _default = new StreamSigner();

exports.default = _default;