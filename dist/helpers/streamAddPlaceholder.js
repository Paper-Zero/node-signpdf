"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = require("fs");

var _plainAddPlaceholder = _interopRequireDefault(require("./plainAddPlaceholder"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const {
  readFile,
  writeFile
} = _fs.promises;

const streamAddPlaceholder = async ({
  pdfPath,
  outputPath = pdfPath,
  ...options
}) => {
  if (typeof pdfPath !== 'string') {
    throw new TypeError('Expected pdfPath to be a string.');
  }

  const pdfBuffer = await readFile(pdfPath);
  const updatedBuffer = (0, _plainAddPlaceholder.default)({
    pdfBuffer,
    ...options
  });
  await writeFile(outputPath, updatedBuffer);
  return outputPath;
};

var _default = streamAddPlaceholder;
exports.default = _default;