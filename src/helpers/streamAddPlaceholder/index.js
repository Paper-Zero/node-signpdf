/* eslint-disable prefer-destructuring */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-use-before-define */
import {createReadStream, createWriteStream, promises as fs} from 'fs';

import {DEFAULT_SIGNATURE_LENGTH, SUBFILTER_ADOBE_PKCS7_DETACHED, DEFAULT_BYTE_RANGE_PLACEHOLDER} from '../const';
import SignPdfError from '../../SignPdfError';

/**
 * Adiciona um placeholder de assinatura ao PDF usando streams
 * Evita carregar o arquivo inteiro na memória
 */
const streamAddPlaceholder = async ({
    pdfPath,
    outputPath = null,
    reason = 'Assinatura Digital',
    contactInfo = 'contato@paperzero.com',
    name = 'Assinatura PaperZero',
    location = 'Brasil',
    signatureLength = DEFAULT_SIGNATURE_LENGTH,
    subFilter = SUBFILTER_ADOBE_PKCS7_DETACHED,
}) => {
    if (typeof pdfPath !== 'string') {
        throw new SignPdfError(
            'PDF path expected as string.',
            SignPdfError.TYPE_INPUT,
        );
    }

    // Verificar se arquivo existe
    try {
        await fs.access(pdfPath);
    } catch (error) {
        throw new SignPdfError(
            `PDF file not found: ${pdfPath}`,
            SignPdfError.TYPE_INPUT,
        );
    }

    const output = outputPath || pdfPath;
    const tempPath = output === pdfPath ? `${pdfPath}.tmp` : output;

    // Primeiro, analisar a estrutura do PDF para encontrar onde inserir a assinatura
    const pdfInfo = await _analyzePdfStructure(pdfPath);

    // Gerar os objetos necessários para a assinatura
    const signatureObjects = _generateSignatureObjects({
        reason,
        contactInfo,
        name,
        location,
        signatureLength,
        subFilter,
        pdfInfo,
    });

    // Escrever PDF modificado com placeholder
    await _writePdfWithPlaceholder(pdfPath, tempPath, pdfInfo, signatureObjects);

    // Se usamos arquivo temporário, renomear
    if (tempPath !== output) {
        await fs.rename(tempPath, output);
    }

    return output;
};

/**
 * Analisa a estrutura do PDF usando streams para identificar onde inserir a assinatura
 */
async function _analyzePdfStructure(pdfPath) {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(pdfPath);
        let buffer = Buffer.alloc(0);
        const xrefOffset = 0;
        let trailerFound = false;
        let rootRef = null;
        let pagesRef = null;
        let maxObjNum = 0;

        stream.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            // Procurar por xref
            const xrefMatch = buffer.toString('latin1').match(/xref\s+(\d+)\s+(\d+)/);
            if (xrefMatch && !trailerFound) {
                const startNum = parseInt(xrefMatch[1]);
                const count = parseInt(xrefMatch[2]);
                maxObjNum = Math.max(maxObjNum, startNum + count - 1);
            }

            // Procurar por trailer e Root
            const trailerMatch = buffer.toString('latin1').match(/trailer\s*<<[^>]*\/Root\s+(\d+\s+\d+\s+R)/);
            if (trailerMatch) {
                rootRef = trailerMatch[1];
                trailerFound = true;
            }

            // Procurar por referência de páginas
            const pagesMatch = buffer.toString('latin1').match(/\/Pages\s+(\d+\s+\d+\s+R)/);
            if (pagesMatch) {
                pagesRef = pagesMatch[1];
            }

            // Manter buffer limitado para busca
            if (buffer.length > 10240) { // 10KB buffer
                buffer = buffer.slice(-5120); // manter últimos 5KB
            }
        });

        stream.on('end', async () => {
            if (!rootRef) {
                reject(new SignPdfError(
                    'Could not find PDF root object reference.',
                    SignPdfError.TYPE_PARSE,
                ));
                return;
            }

            const fileStats = await fs.stat(pdfPath);

            resolve({
                rootRef,
                pagesRef,
                maxObjNum,
                fileSize: fileStats.size,
                xrefOffset,
            });
        });

        stream.on('error', reject);
    });
}

/**
 * Gera os objetos necessários para inserir a assinatura no PDF
 */
function _generateSignatureObjects({
    reason, contactInfo, name, location, signatureLength, subFilter, pdfInfo,
}) {
    const nextObjNum = pdfInfo.maxObjNum + 1;
    const acroFormRef = `${nextObjNum} 0 R`;
    const signatureRef = `${nextObjNum + 1} 0 R`;
    const annotRef = `${nextObjNum + 2} 0 R`;

    // Placeholder para ByteRange - será preenchido durante assinatura
    const byteRangePlaceholder = DEFAULT_BYTE_RANGE_PLACEHOLDER;

    // Placeholder para assinatura - será preenchido durante assinatura
    const signaturePlaceholder = `<${'0'.repeat(signatureLength)}>`;

    // Objeto AcroForm
    const acroFormObj = `${nextObjNum} 0 obj
<<
/Fields [${signatureRef}]
/SigFlags 3
>>
endobj
`;

    // Objeto de assinatura
    const signatureObj = `${nextObjNum + 1} 0 obj
<<
/Type /Sig
/Filter /Adobe.PPKLite
/SubFilter /${subFilter}
/ByteRange [${byteRangePlaceholder}]
/Contents ${signaturePlaceholder}
/Reason (${reason})
/ContactInfo (${contactInfo})
/Name (${name})
/Location (${location})
/M (D:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, '+00\'00\'')})
>>
endobj
`;

    // Objeto de anotação (invisível)
    const annotationObj = `${nextObjNum + 2} 0 obj
<<
/Type /Annot
/Subtype /Widget
/FT /Sig
/Rect [0 0 0 0]
/V ${signatureRef}
/T (Signature)
/F 132
/P ${pdfInfo.pagesRef || '1 0 R'}
>>
endobj
`;

    return {
        acroFormRef,
        signatureRef,
        annotRef,
        acroFormObj,
        signatureObj,
        annotationObj,
        nextObjNum: nextObjNum + 3,
    };
}

/**
 * Escreve o PDF modificado com placeholder de assinatura usando streams
 */
async function _writePdfWithPlaceholder(inputPath, outputPath, pdfInfo, signatureObjects) {
    const readStream = createReadStream(inputPath);
    const writeStream = createWriteStream(outputPath);

    let xrefStarted = false;
    let buffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
        readStream.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            // Procurar pelo início da tabela xref
            if (!xrefStarted) {
                const xrefIndex = buffer.indexOf('xref');

                if (xrefIndex !== -1) {
                    // Escrever tudo antes do xref
                    writeStream.write(buffer.slice(0, xrefIndex));

                    // Inserir objetos de assinatura antes do xref
                    writeStream.write(Buffer.from(`\n${signatureObjects.acroFormObj}\n`));
                    writeStream.write(Buffer.from(`${signatureObjects.signatureObj}\n`));
                    writeStream.write(Buffer.from(`${signatureObjects.annotationObj}\n`));

                    // Continuar com xref modificado
                    const xrefContent = buffer.slice(xrefIndex);
                    const modifiedXref = _modifyXref(xrefContent, signatureObjects, pdfInfo);
                    writeStream.write(modifiedXref);

                    xrefStarted = true;
                    buffer = Buffer.alloc(0);
                // Escrever o chunk se não encontramos xref ainda
                } else if (buffer.length > chunk.length) {
                    writeStream.write(buffer.slice(0, -chunk.length));
                    buffer = buffer.slice(-chunk.length);
                }
            } else {
                // Após xref, escrever normalmente
                writeStream.write(chunk);
            }
        });

        readStream.on('end', () => {
            if (!xrefStarted && buffer.length > 0) {
                // Se não encontramos xref, escrever buffer restante
                writeStream.write(buffer);
            }
            writeStream.end();
            resolve();
        });

        readStream.on('error', reject);
        writeStream.on('error', reject);
    });
}

/**
 * Modifica a tabela xref para incluir os novos objetos
 */
function _modifyXref(xrefContent, signatureObjects) {
    let content = xrefContent.toString('latin1');

    // Encontrar linha de contagem de objetos
    const xrefMatch = content.match(/xref\s+(\d+)\s+(\d+)/);
    if (!xrefMatch) {
        return xrefContent; // Retornar original se não conseguir modificar
    }

    const startNum = parseInt(xrefMatch[1]);
    const originalCount = parseInt(xrefMatch[2]);
    const newCount = originalCount + 3; // Adicionamos 3 objetos

    // Substituir contagem
    content = content.replace(/xref\s+\d+\s+\d+/, `xref\n${startNum} ${newCount}`);

    // Adicionar entradas para os novos objetos (calcular offsets aproximados)
    const newEntries = `${(signatureObjects.nextObjNum - 3).toString().padStart(10, '0')} 00000 n \n`
                      + `${(signatureObjects.nextObjNum - 2).toString().padStart(10, '0')} 00000 n \n`
                      + `${(signatureObjects.nextObjNum - 1).toString().padStart(10, '0')} 00000 n \n`;

    // Inserir antes do trailer
    const trailerIndex = content.indexOf('trailer');
    if (trailerIndex !== -1) {
        content = content.slice(0, trailerIndex) + newEntries + content.slice(trailerIndex);

        // Modificar trailer para incluir AcroForm
        content = content.replace(
            /trailer\s*<<([^>]*)>>/,
            `trailer\n<<$1/AcroForm ${signatureObjects.acroFormRef}>>`,
        );
    }

    return Buffer.from(content, 'latin1');
}

export default streamAddPlaceholder;
