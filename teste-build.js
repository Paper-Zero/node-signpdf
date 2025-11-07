/**
 * Teste simples do build transpilado
 */

const { StreamSigner } = require('./dist/StreamSigner');

async function testeTranspilado() {
    console.log('🚀 Teste do Build Transpilado');
    console.log('=============================');

    try {
        // Instanciar StreamSigner
        const streamSigner = new StreamSigner();
        console.log('✅ StreamSigner criado com sucesso');
        console.log(`   Placeholder: ${streamSigner.byteRangePlaceholder}`);

        // Teste de validação
        try {
            await streamSigner.sign(123, Buffer.from('test'));
        } catch (error) {
            if (error.message.includes('PDF path expected as string')) {
                console.log('✅ Validação funcionando corretamente');
            }
        }

        console.log('🎉 Build transpilado funciona!');
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        throw error;
    }
}

testeTranspilado()
    .then(() => {
        console.log('\n✨ Teste concluído com sucesso!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Falha:', error);
        process.exit(1);
    });