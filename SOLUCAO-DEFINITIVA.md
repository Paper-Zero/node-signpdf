# 🔴 PROBLEMA IDENTIFICADO

O erro `Could not find empty ByteRange placeholder` ocorre porque:

1. `pdf-lib.save()` gera PDF sem placeholder de assinatura
2. `StreamSigner` procura o placeholder mas não encontra
3. Para criar placeholder em arquivos grandes, `plainAddPlaceholder` estoura memória

## 🎯 SOLUÇÃO: Duas Abordagens

### ❌ Problema Atual
```
PDF (1.1GB) → pdf-lib.save() → Buffer (1.1GB) 
            → StreamSigner.sign() → ❌ Sem placeholder!
```

### ✅ Solução Correta

**OPÇÃO 1: Limitar processamento do pdf-lib (RECOMENDADO)**

Para arquivos grandes, **não adicione a página de relatório**. Isso permite usar o PDF original:

```javascript
async addDigitalSignatureToPdf(pdfBuffer, signerName, originalPdfPath = null) {
    const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024; // 400 MB
    const isLargeFile = pdfBuffer.length > LARGE_FILE_THRESHOLD;
    
    if (isLargeFile && originalPdfPath) {
        // ARQUIVOS GRANDES: Usar PDF original (sem modificações do pdf-lib)
        log.info('Arquivo grande detectado - usando PDF original...');
        
        const tempDir = os.tmpdir();
        const tempOutputPath = path.join(tempDir, `pzsign-output-${Date.now()}.pdf`);
        
        try {
            // Recriar P12
            const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
                this.privateKey,
                this.certificateChain,
                '',
                { generateLocalKeyId: true, friendlyName: 'Certificado Digital ICP-Brasil', algorithm: '3des' }
            );
            const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
            
            // Usar StreamSigner com PDF ORIGINAL (já tem estrutura correta)
            const streamSigner = new StreamSigner();
            await streamSigner.sign(
                originalPdfPath,  // ← PDF original, não o modificado
                p12Buffer,
                {
                    outputPath: tempOutputPath,
                    reason: 'Assinatura digital com certificado ICP-Brasil',
                    contactInfo: 'PaperZero Digital Signature',
                    name: signerName,
                    location: 'Brasil'
                }
            );
            
            const signedPdf = fs.readFileSync(tempOutputPath);
            return signedPdf;
            
        } finally {
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        }
    } else {
        // ARQUIVOS PEQUENOS: Método tradicional
        const pdfWithPlaceholder = plainAddPlaceholder({
            pdfBuffer,
            reason: 'Assinatura digital com certificado ICP-Brasil',
            contactInfo: 'PaperZero Digital Signature',
            name: signerName,
            location: 'Brasil'
        });
        
        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
            this.privateKey, this.certificateChain, '',
            { generateLocalKeyId: true, friendlyName: 'Certificado Digital ICP-Brasil', algorithm: '3des' }
        );
        const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
        
        const signer = new SignPdf();
        return signer.sign(pdfWithPlaceholder, p12Buffer);
    }
}
```

E modificar `signPDF()`:

```javascript
async signPDF(inputPath, outputPath) {
    // ... código existente ...
    
    const fileStats = fs.statSync(inputPath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    const LARGE_FILE_THRESHOLD = 400;
    
    let pdfBytes;
    
    if (fileSizeMB > LARGE_FILE_THRESHOLD) {
        // ARQUIVO GRANDE: Não adicionar página de relatório
        log.warn(`Arquivo grande (${fileSizeMB.toFixed(2)} MB) - pulando página de relatório`);
        pdfBytes = existingPdfBytes; // Usar PDF original
    } else {
        // ARQUIVO PEQUENO: Processar normalmente
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        
        // Adicionar texto em rodapés
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const { width } = page.getSize();
            page.drawText(`PaperZero ${signatureHash}. Documento assinado eletronicamente.`, {
                x: 50, y: 30, size: 7, font: font, color: rgb(0.6, 0.6, 0.6),
                maxWidth: width - 100
            });
        }
        
        // Adicionar metadados
        pdfDoc.setTitle(`${pdfDoc.getTitle() || 'Documento'} - Assinado Digitalmente`);
        pdfDoc.setProducer(`PzDeskSign v${version}`);
        
        // Adicionar página de relatório
        await this.addSignatureReportPage(pdfDoc, signatureHash, signerName, signatureDate, inputPath, originalDocHash);
        
        pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    }
    
    // Assinar
    const signedPdfBytes = await this.addDigitalSignatureToPdf(
        Buffer.from(pdfBytes), 
        signerName,
        fileSizeMB > LARGE_FILE_THRESHOLD ? inputPath : null  // ← Passar path original
    );
    
    // ... salvar arquivo ...
}
```

---

**OPÇÃO 2: Criar placeholder via streaming (mais complexo)**

Criar arquivo temporário com placeholder antes de assinar:

```javascript
if (isLargeFile) {
    const tempInputPath = path.join(tempDir, `pzsign-input-${Date.now()}.pdf`);
    const tempWithPlaceholder = path.join(tempDir, `pzsign-placeholder-${Date.now()}.pdf`);
    const tempOutputPath = path.join(tempDir, `pzsign-output-${Date.now()}.pdf`);
    
    try {
        // 1. Salvar PDF
        fs.writeFileSync(tempInputPath, pdfBuffer);
        
        // 2. Adicionar placeholder via plainAddPlaceholder em chunks (HACK)
        // Ou implementar streamAddPlaceholder (trabalho extra)
        
        // 3. Assinar com StreamSigner
        await streamSigner.sign(tempWithPlaceholder, p12Buffer, { outputPath: tempOutputPath });
        
        return fs.readFileSync(tempOutputPath);
    } finally {
        // cleanup
    }
}
```

---

## 📋 RECOMENDAÇÃO

Use **OPÇÃO 1** porque:
- ✅ Simples de implementar
- ✅ Funciona imediatamente
- ✅ Não precisa criar novos helpers
- ⚠️ Desvantagem: Arquivos grandes não terão página de relatório
- 💡 Alternativa: Gerar relatório separado (outro PDF)

Para arquivos grandes, você pode:
1. Assinar o PDF original (sem modificações)
2. Gerar PDF de relatório separado
3. Ou avisar usuário que relatório está disponível apenas para arquivos < 400MB
