#!/usr/bin/env node

/**
 * Teste rápido do StreamSigner
 * Verifica se a implementação básica está funcionando
 */

import { promises as fs } from 'fs';
import path from 'path';
import { StreamSigner } from './src/StreamSigner.js';

async function testeRapido() {
    console.log('🧪 Teste Rápido do StreamSigner');
    console.log('================================');

    try {
        // Verificar se StreamSigner pode ser instanciado
        const streamSigner = new StreamSigner();
        console.log('✅ StreamSigner instanciado com sucesso');

        // Verificar propriedades básicas
        console.log(`   Placeholder padrão: ${streamSigner.byteRangePlaceholder}`);
        console.log(`   Última assinatura: ${streamSigner.lastSignature}`);

        // Verificar se métodos existem
        const metodos = ['sign', '_prepareCertificate', '_createPKCS7Signature'];
        metodos.forEach(metodo => {
            if (typeof streamSigner[metodo] === 'function') {
                console.log(`✅ Método ${metodo} existe`);
            } else {
                console.log(`❌ Método ${metodo} não encontrado`);
            }
        });

        // Teste de validação de entrada
        console.log('\n📝 Testando validações de entrada...');
        
        try {
            await streamSigner.sign(123, Buffer.from('test'));
        } catch (error) {
            if (error.message.includes('PDF path expected as string')) {
                console.log('✅ Validação de tipo PDF funcionando');
            }
        }

        try {
            await streamSigner.sign('/caminho/inexistente.pdf', 'not-buffer');
        } catch (error) {
            if (error.message.includes('p12 certificate expected as Buffer')) {
                console.log('✅ Validação de certificado funcionando');
            }
        }

        console.log('\n🎉 Teste básico concluído com sucesso!');
        console.log('\n💡 Para testar assinatura real, use:');
        console.log('   node examples/stream-signer-example.js');

    } catch (error) {
        console.error('❌ Erro durante teste:', error.message);
        throw error;
    }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    testeRapido()
        .then(() => {
            console.log('\n✨ Teste finalizado!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Falha no teste:', error);
            process.exit(1);
        });
}

export default testeRapido;