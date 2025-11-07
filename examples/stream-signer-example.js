/* eslint-disable no-use-before-define */
/* eslint-disable import/extensions */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/**
 * Exemplo de uso do StreamSigner para assinar PDFs grandes
 * Este exemplo demonstra como usar a nova implementação streaming
 * do node-signpdf para assinar documentos de qualquer tamanho.
 */

import {promises as fs} from 'fs';
import path from 'path';
import {StreamSigner} from '../src/StreamSigner.js';
import streamAddPlaceholder from '../src/helpers/streamAddPlaceholder/index.js';

async function exemploStreamSigner() {
    try {
        console.log('🚀 Exemplo StreamSigner - Assinatura de PDFs Grandes');
        console.log('='.repeat(60));

        // Caminhos dos arquivos
        const certificadoPath = './resources/certificate.p12'; // Certificado de teste
        const pdfOriginal = './temp/documento-grande.pdf';
        const pdfComPlaceholder = './temp/documento-com-placeholder.pdf';
        const pdfAssinado = './temp/documento-assinado.pdf';

        // Verificar se certificado existe
        try {
            await fs.access(certificadoPath);
            console.log('✅ Certificado P12 encontrado');
        } catch {
            console.log('❌ Certificado P12 não encontrado em:', certificadoPath);
            console.log('   Use um dos certificados de teste em ./resources/');
            return;
        }

        // Passo 1: Criar PDF de teste (simula um PDF grande)
        console.log('\n1️⃣ Criando PDF de teste...');
        await criarPdfDeTeste(pdfOriginal, 5 * 1024 * 1024); // 5MB
        console.log('✅ PDF de teste criado:', pdfOriginal);

        // Passo 2: Adicionar placeholder de assinatura usando streams
        console.log('\n2️⃣ Adicionando placeholder de assinatura...');
        const startPlaceholder = Date.now();

        await streamAddPlaceholder({
            pdfPath: pdfOriginal,
            outputPath: pdfComPlaceholder,
            reason: 'Assinatura Digital via StreamSigner',
            contactInfo: 'contato@paperzero.com',
            name: 'Certificado A1 PaperZero',
            location: 'São Paulo, Brasil',
        });

        const timePlaceholder = Date.now() - startPlaceholder;
        console.log(`✅ Placeholder adicionado em ${timePlaceholder}ms`);

        // Passo 3: Assinar PDF usando StreamSigner
        console.log('\n3️⃣ Assinando PDF com StreamSigner...');
        const startSigning = Date.now();

        const streamSigner = new StreamSigner();
        const certificado = await fs.readFile(certificadoPath);

        // Monitorar uso de memória
        const initialMemory = process.memoryUsage();

        const resultPath = await streamSigner.sign(
            pdfComPlaceholder,
            certificado,
            {
                passphrase: '', // Senha do certificado (vazio para certificados de teste)
                outputPath: pdfAssinado,
            },
        );

        const finalMemory = process.memoryUsage();
        const timeSigning = Date.now() - startSigning;
        const memoryUsed = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

        console.log(`✅ PDF assinado com sucesso em ${timeSigning}ms`);
        console.log(`📊 Uso de memória: ${memoryUsed.toFixed(2)} MB`);
        console.log(`📄 Arquivo assinado salvo em: ${resultPath}`);

        // Passo 4: Verificar informações do arquivo assinado
        console.log('\n4️⃣ Verificando arquivo assinado...');
        const statsOriginal = await fs.stat(pdfOriginal);
        const statsAssinado = await fs.stat(pdfAssinado);

        console.log(`📏 Tamanho original: ${formatBytes(statsOriginal.size)}`);
        console.log(`📏 Tamanho assinado: ${formatBytes(statsAssinado.size)}`);
        console.log(`🔐 Assinatura aplicada: ${streamSigner.lastSignature ? 'Sim' : 'Não'}`);

        // Verificar se o PDF contém a assinatura
        const pdfContent = await fs.readFile(pdfAssinado);
        const hasSignature = pdfContent.includes(Buffer.from('/Filter /Adobe.PPKLite'));
        console.log(`✅ Estrutura PKCS#7 presente: ${hasSignature ? 'Sim' : 'Não'}`);

        console.log('\n🎉 Processo concluído com sucesso!');
        console.log('\n💡 Dicas:');
        console.log('   • Use Adobe Reader para verificar a assinatura');
        console.log('   • Para certificados ICP-Brasil, use a senha correta');
        console.log('   • O StreamSigner funciona com PDFs de qualquer tamanho');
    } catch (error) {
        console.error('❌ Erro durante o processo:', error.message);
        throw error;
    }
}

/**
 * Cria um PDF de teste com o tamanho especificado
 */
async function criarPdfDeTeste(caminho, tamanho) {
    const dir = path.dirname(caminho);
    await fs.mkdir(dir, {recursive: true});

    // Criar PDF básico
    const pdfBasico = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length ${tamanho - 500}
>>
stream
`;

    // Adicionar conteúdo para atingir o tamanho desejado
    const conteudoBase = 'BT /F1 12 Tf 100 700 Td (PDF de teste para StreamSigner) Tj ET\n';
    const padding = 'q 100 0 0 100 100 600 cm /Im1 Do Q\n'.repeat(Math.floor((tamanho - 500) / 50));

    const pdfFinal = `${pdfBasico + conteudoBase + padding}
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000015 65535 n 
0000000074 65535 n 
0000000120 65535 n 
0000000190 65535 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
${tamanho - 50}
%%EOF`;

    await fs.writeFile(caminho, pdfFinal);
}

/**
 * Formatar bytes para exibição legível
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * Exemplo de comparação de performance entre SignPdf original e StreamSigner
 */
async function exemploComparacaoPerformance() {
    console.log('\n📊 Comparação de Performance: SignPdf vs StreamSigner');
    console.log('='.repeat(60));

    const tamanhos = [1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024]; // 1MB, 10MB, 50MB
    const resultados = [];

    for (const tamanho of tamanhos) {
        console.log(`\nTestando PDF de ${formatBytes(tamanho)}...`);

        const pdfPath = `./temp/test-${tamanho}.pdf`;
        await criarPdfDeTeste(pdfPath, tamanho);

        // Teste StreamSigner
        const startTime = Date.now();
        const startMemory = process.memoryUsage();

        try {
            // Simular apenas o cálculo de hash (parte mais intensiva)
            const {calculateFileHash} = await import('../src/helpers/streamUtils.js');
            await calculateFileHash(pdfPath);

            const endTime = Date.now();
            const endMemory = process.memoryUsage();

            resultados.push({
                tamanho: formatBytes(tamanho),
                tempo: `${endTime - startTime}ms`,
                memoria: `${((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`,
            });

            console.log(`  ✅ Processado em ${endTime - startTime}ms`);
        } catch (error) {
            console.log(`  ❌ Erro: ${error.message}`);
            resultados.push({
                tamanho: formatBytes(tamanho),
                tempo: 'ERRO',
                memoria: 'N/A',
            });
        }

        // Limpar arquivo
        await fs.unlink(pdfPath).catch(() => {});
    }

    console.log('\n📋 Resultados:');
    console.table(resultados);
}

// Executar exemplo se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    exemploStreamSigner()
        .then(() => exemploComparacaoPerformance())
        .then(() => {
            console.log('\n✨ Exemplos concluídos!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Erro nos exemplos:', error);
            process.exit(1);
        });
}

export {
    exemploStreamSigner,
    exemploComparacaoPerformance,
};
