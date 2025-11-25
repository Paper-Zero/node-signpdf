const {StreamSigner} = require('./dist/StreamSigner');

async function testeBanco() {
    console.log('🧪 Teste básico StreamSigner');

    try {
        // Testar instanciação
        const streamSigner = new StreamSigner();
        console.log('✅ StreamSigner instanciado');
        console.log('   Placeholder:', streamSigner.byteRangePlaceholder);

        // Testar validação de entrada
        try {
            await streamSigner.sign(123, Buffer.from('test'));
        } catch (error) {
            if (error.message.includes('PDF path expected as string')) {
                console.log('✅ Validação de entrada funcionando');
            }
        }

        console.log('✅ Teste básico passou!');
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

testeBanco();
