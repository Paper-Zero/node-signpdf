import fs from 'fs';
import os from 'os';
import path from 'path';
import {promises as fsPromises} from 'fs';
import PDFDocument from 'pdfkit';
import streamSigner from '../src/StreamSigner';
import SignPdfError from '../src/SignPdfError';
import {pdfkitAddPlaceholder, extractSignature} from '../src/helpers';

const {mkdtemp, rm, writeFile, readFile} = fsPromises;

const tempDirs = new Set();

const createPdf = (params) => new Promise((resolve) => {
    const requestParams = {
        placeholder: {},
        text: 'node-signpdf-stream',
        addSignaturePlaceholder: true,
        pages: 1,
        layout: 'portrait',
        ...params,
    };

    const pdf = new PDFDocument({
        autoFirstPage: false,
        size: 'A4',
        layout: requestParams.layout,
        bufferPages: true,
    });
    pdf.info.CreationDate = '';

    if (requestParams.pages < 1) {
        requestParams.pages = 1;
    }

    for (let i = 0; i < requestParams.pages; i += 1) {
        pdf
            .addPage()
            .fillColor('#333')
            .fontSize(25)
            .moveDown()
            .text(requestParams.text)
            .save();
    }

    const pdfChunks = [];
    pdf.on('data', (data) => {
        pdfChunks.push(data);
    });
    pdf.on('end', () => {
        resolve(Buffer.concat(pdfChunks));
    });

    if (requestParams.addSignaturePlaceholder) {
        const refs = pdfkitAddPlaceholder({
            pdf,
            pdfBuffer: Buffer.from([pdf]),
            reason: 'Streamed',
            ...requestParams.placeholder,
        });
        Object.keys(refs).forEach((key) => refs[key].end());
    }

    pdf.end();
});

const writePdfToTempFile = async (pdfBuffer) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stream-signer-'));
    const filePath = path.join(dir, 'document.pdf');
    await writeFile(filePath, pdfBuffer);
    tempDirs.add(dir);
    return {dir, filePath};
};

describe('StreamSigner', () => {
    const certificatePath = path.join(__dirname, '../resources/certificate.p12');
    const p12Buffer = fs.readFileSync(certificatePath);

    afterEach(async () => {
        await Promise.all(Array.from(tempDirs).map((dir) => rm(dir, {recursive: true, force: true})));
        tempDirs.clear();
    });

    it('signs a PDF using streaming mode', async () => {
        const pdfBuffer = await createPdf();

        const {filePath} = await writePdfToTempFile(pdfBuffer);

        await streamSigner.sign(filePath, p12Buffer);

        const signedBuffer = await readFile(filePath);
        const {signature, signedData} = extractSignature(signedBuffer);

        expect(typeof signature).toBe('string');
        expect(signature.length).toBeGreaterThan(0);
        expect(signedData instanceof Buffer).toBe(true);
        expect(streamSigner.lastSignature).toBeDefined();

    });

    it('throws when PDF lacks a placeholder', async () => {
        const pdfBuffer = await createPdf({addSignaturePlaceholder: false});
        const {filePath} = await writePdfToTempFile(pdfBuffer);

        await expect(streamSigner.sign(filePath, p12Buffer)).rejects.toMatchObject({
            type: SignPdfError.TYPE_PARSE,
        });

    });
});
