import {promises as fsPromises} from 'fs';
import plainAddPlaceholder from './plainAddPlaceholder';

const {readFile, writeFile} = fsPromises;

const streamAddPlaceholder = async ({pdfPath, outputPath = pdfPath, ...options}) => {
    if (typeof pdfPath !== 'string') {
        throw new TypeError('Expected pdfPath to be a string.');
    }

    const pdfBuffer = await readFile(pdfPath);
    const updatedBuffer = plainAddPlaceholder({
        pdfBuffer,
        ...options,
    });

    await writeFile(outputPath, updatedBuffer);

    return outputPath;
};

export default streamAddPlaceholder;
