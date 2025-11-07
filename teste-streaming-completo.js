#!/usr/bin/env node

const fs = require('fs');

// Importar classes necessárias
const {StreamSigner} = require('./dist/StreamSigner');
const streamAddPlaceholderModule = require('./dist/helpers/streamAddPlaceholder');

// Extrair a função default
const streamAddPlaceholder = streamAddPlaceholderModule.default || streamAddPlaceholderModule;

// Configurações
const CERTIFICATE_PATH = './resources/certificate.p12';
const CERTIFICATE_PASSPHRASE = '';

// Arquivos de teste
const TEST_FILES = [
    {
        name: 'PDF Pequeno (181KB)',
        input: './POAB673363.pdf',
        withPlaceholder: './POAB673363_com_placeholder.pdf',
        output: './POAB673363_assinado.pdf',
    },
    {
        name: 'PDF Grande (1.2GB)',
        input: './PREGÃO_11_LI_2024-06-27_2024.pdf',
        withPlaceholder: './PREGÃO_11_LI_2024-06-27_2024_com_placeholder.pdf',
        output: './PREGÃO_11_LI_2024-06-27_2024_assinado.pdf',
    },
];

function verificarArquivos() {
    // eslint-disable-next-line no-console
    console.log('🔍 Verificando arquivos necessários...\n');

    // Verificar se o certificado existe
    if (!fs.existsSync(CERTIFICATE_PATH)) {
        // eslint-disable-next-line no-console
        console.error(`❌ Certificado não encontrado: ${CERTIFICATE_PATH}`);
        // eslint-disable-next-line no-console
        console.log('💡 Use um dos certificados em ./resources/ ou ajuste o caminho\n');
        return false;
    }

    // Verificar PDFs de teste
    return TEST_FILES.every((file) => {
        if (!fs.existsSync(file.input)) {
            // eslint-disable-next-line no-console
            console.error(`❌ PDF não encontrado: ${file.input}`);
            return false;
        }

        const stats = fs.statSync(file.input);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        // eslint-disable-next-line no-console
        console.log(`✅ ${file.name}: ${file.input} (${sizeInMB} MB)`);
        return true;
    });
}

function medirMemoriaUsage() {
    const used = process.memoryUsage();
    return {
        rss: Math.round((used.rss / 1024 / 1024) * 100) / 100,
        heapUsed: Math.round((used.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((used.heapTotal / 1024 / 1024) * 100) / 100,
        external: Math.round((used.external / 1024 / 1024) * 100) / 100,
    };
}

async function testarFluxoCompleto(testFile) {
    // eslint-disable-next-line no-console
    console.log(`🚀 Testando: ${testFile.name}`);
    // eslint-disable-next-line no-console
    console.log(`📁 PDF Original: ${testFile.input}`);

    try {
        // Medir memória inicial
        const memoriaInicial = medirMemoriaUsage();
        // eslint-disable-next-line no-console
        console.log(`💾 Memória inicial: ${memoriaInicial.heapUsed} MB`);

        // Limpar arquivos anteriores se existirem
        if (fs.existsSync(testFile.withPlaceholder)) {
            fs.unlinkSync(testFile.withPlaceholder);
        }
        if (fs.existsSync(testFile.output)) {
            fs.unlinkSync(testFile.output);
        }

        // ETAPA 1: Adicionar placeholder de assinatura
        // eslint-disable-next-line no-console
        console.log('📝 Adicionando placeholder de assinatura...');
        const inicioPlaceholder = Date.now();

        await streamAddPlaceholder({
            pdfPath: testFile.input,
            outputPath: testFile.withPlaceholder,
        });

        const tempoPlaceholder = Date.now() - inicioPlaceholder;

        // Verificar se arquivo com placeholder foi criado
        if (!fs.existsSync(testFile.withPlaceholder)) {
            throw new Error('Falha ao criar PDF com placeholder');
        }

        const memoriaAposPlaceholder = medirMemoriaUsage();
        // eslint-disable-next-line no-console
        console.log(`✅ Placeholder adicionado em ${(tempoPlaceholder / 1000).toFixed(2)}s`);
        // eslint-disable-next-line no-console
        console.log(`💾 Memória após placeholder: ${memoriaAposPlaceholder.heapUsed} MB`);

        // ETAPA 2: Assinar o PDF com placeholder
        // eslint-disable-next-line no-console
        console.log('✍️  Assinando PDF...');
        const certificado = fs.readFileSync(CERTIFICATE_PATH);
        const streamSigner = new StreamSigner();

        const inicioAssinatura = Date.now();

        const outputPath = await streamSigner.sign(
            testFile.withPlaceholder,
            certificado,
            {
                passphrase: CERTIFICATE_PASSPHRASE,
                outputPath: testFile.output,
            },
        );

        const tempoAssinatura = Date.now() - inicioAssinatura;
        const tempoTotal = Date.now() - inicioPlaceholder;

        // Medir memória final
        const memoriaFinal = medirMemoriaUsage();
        const diferencaMemoria = memoriaFinal.heapUsed - memoriaInicial.heapUsed;

        // Verificar resultados
        if (fs.existsSync(outputPath)) {
            const statsOriginal = fs.statSync(testFile.input);
            const statsComPlaceholder = fs.statSync(testFile.withPlaceholder);
            const statsAssinado = fs.statSync(outputPath);

            // eslint-disable-next-line no-console
            console.log('✅ Fluxo completo concluído com sucesso!');
            // eslint-disable-next-line no-console
            console.log('📊 Estatísticas:');
            // eslint-disable-next-line no-console
            console.log(`   • Tempo placeholder: ${(tempoPlaceholder / 1000).toFixed(2)}s`);
            // eslint-disable-next-line no-console
            console.log(`   • Tempo assinatura: ${(tempoAssinatura / 1000).toFixed(2)}s`);
            // eslint-disable-next-line no-console
            console.log(`   • Tempo total: ${(tempoTotal / 1000).toFixed(2)}s`);
            // eslint-disable-next-line no-console
            console.log(`   • Memória usada: +${diferencaMemoria.toFixed(2)} MB`);
            // eslint-disable-next-line no-console
            console.log(`   • Memória final: ${memoriaFinal.heapUsed} MB`);
            // eslint-disable-next-line no-console
            console.log(`   • Tamanho original: ${(statsOriginal.size / (1024 * 1024)).toFixed(2)} MB`);
            // eslint-disable-next-line no-console
            console.log(`   • Tamanho c/ placeholder: ${(statsComPlaceholder.size / (1024 * 1024)).toFixed(2)} MB`);
            // eslint-disable-next-line no-console
            console.log(`   • Tamanho assinado: ${(statsAssinado.size / (1024 * 1024)).toFixed(2)} MB`);

            // Limpar arquivo intermediário
            fs.unlinkSync(testFile.withPlaceholder);

            return {
                sucesso: true,
                tempoPlaceholder,
                tempoAssinatura,
                tempoTotal,
                memoriaUsada: diferencaMemoria,
                tamanhoOriginal: statsOriginal.size,
                tamanhoAssinado: statsAssinado.size,
            };
        }

        throw new Error('Arquivo assinado não foi criado');
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ Erro no fluxo:');
        // eslint-disable-next-line no-console
        console.error(`   ${error.message}`);
        if (error.stack) {
            // eslint-disable-next-line no-console
            console.error(`   Stack: ${error.stack.split('\n')[1]?.trim() || error.stack}`);
        }

        // Limpar arquivos em caso de erro
        if (fs.existsSync(testFile.withPlaceholder)) {
            fs.unlinkSync(testFile.withPlaceholder);
        }

        return {sucesso: false, erro: error.message};
    }
}

async function executarTestes() {
    // eslint-disable-next-line no-console
    console.log('🔥 TESTE COMPLETO DO STREAMSIGNER - FLUXO PLACEHOLDER + ASSINATURA\n');
    // eslint-disable-next-line no-console
    console.log('======================================================================\n');

    // Verificar arquivos
    if (!verificarArquivos()) {
        process.exit(1);
    }

    const resultados = [];

    // Executar testes para cada arquivo
    for (let i = 0; i < TEST_FILES.length; i += 1) {
        const testFile = TEST_FILES[i];

        // eslint-disable-next-line no-console
        console.log('----------------------------------------------------------------------');
        // eslint-disable-next-line no-console
        console.log(`\n📋 TESTE ${i + 1}/${TEST_FILES.length}\n`);

        // eslint-disable-next-line no-await-in-loop
        const resultado = await testarFluxoCompleto(testFile);
        resultados.push({
            arquivo: testFile.name,
            ...resultado,
        });

        // eslint-disable-next-line no-console
        console.log(''); // Linha em branco

        // Pequena pausa entre testes para clear memory
        if (i < TEST_FILES.length - 1) {
            // eslint-disable-next-line no-console
            console.log('⏳ Aguardando 5 segundos para o próximo teste...\n');
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
                setTimeout(resolve, 5000);
            });

            // Força garbage collection se disponível
            if (global.gc) {
                global.gc();
            }
        }
    }

    // Resumo final
    // eslint-disable-next-line no-console
    console.log('======================================================================');
    // eslint-disable-next-line no-console
    console.log('\n📊 RESUMO DOS TESTES\n');

    let todosPassaram = true;

    resultados.forEach((resultado, index) => {
        const status = resultado.sucesso ? '✅ PASSOU' : '❌ FALHOU';
        // eslint-disable-next-line no-console
        console.log(`${index + 1}. ${resultado.arquivo}: ${status}`);

        if (resultado.sucesso) {
            // eslint-disable-next-line no-console
            console.log(`   • Tempo total: ${(resultado.tempoTotal / 1000).toFixed(2)}s`);
            // eslint-disable-next-line no-console
            console.log(`   • Memória: +${resultado.memoriaUsada.toFixed(2)} MB`);
            // eslint-disable-next-line no-console
            console.log(`   • Tamanho: ${(resultado.tamanhoOriginal / (1024 * 1024)).toFixed(2)} → ${(resultado.tamanhoAssinado / (1024 * 1024)).toFixed(2)} MB`);
        } else {
            // eslint-disable-next-line no-console
            console.log(`   • Erro: ${resultado.erro}`);
            todosPassaram = false;
        }
        // eslint-disable-next-line no-console
        console.log('');
    });

    if (todosPassaram) {
        // eslint-disable-next-line no-console
        console.log('🎉 TODOS OS TESTES PASSARAM!');
        // eslint-disable-next-line no-console
        console.log('🚀 StreamSigner funcionando perfeitamente para PDFs pequenos e grandes!');
        // eslint-disable-next-line no-console
        console.log('💡 Fluxo completo: Placeholder + Assinatura funcionando sem limite de tamanho!');
    } else {
        // eslint-disable-next-line no-console
        console.log('⚠️  Alguns testes falharam. Verifique os erros acima.');
    }

    // eslint-disable-next-line no-console
    console.log('\n======================================================================');

    return todosPassaram;
}

// Executar testes
if (require.main === module) {
    executarTestes().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('\n💥 Erro fatal:', error.message);
        process.exit(1);
    });
}

module.exports = {executarTestes, testarFluxoCompleto};
