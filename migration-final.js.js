// migration-final.js - Script para migração definitiva
async function performFinalMigration() {
    console.log('=== INICIANDO MIGRAÇÃO DEFINITIVA ===');
    
    // 1. Verificar se IndexedDB está funcionando
    const dbInfo = await databaseManager.getDatabaseInfo();
    if (!dbInfo) {
        console.error('IndexedDB não está disponível');
        return false;
    }
    
    // 2. Fazer backup completo
    console.log('Criando backup completo...');
    const backupData = await databaseManager.exportDatabase();
    const backupStr = JSON.stringify(backupData, null, 2);
    
    // 3. Salvar backup em múltiplos lugares
    localStorage.setItem('camarim-final-backup', backupStr);
    
    // Opcional: Oferecer download
    const blob = new Blob([backupStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `camarim-backup-pre-migration-${new Date().toISOString().slice(0,10)}.json`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // 4. Migrar dados restantes do localStorage
    const localStorageData = localStorage.getItem('camarim-system-data');
    if (localStorageData) {
        try {
            const data = JSON.parse(localStorageData);
            await databaseManager.saveSystemData(data);
            console.log('Dados finais migrados do localStorage');
        } catch (error) {
            console.error('Erro na migração final:', error);
        }
    }
    
    // 5. Remover dados ativos do localStorage
    localStorage.removeItem('camarim-system-data');
    
    // 6. Configurar sistema para usar apenas IndexedDB
    storageAdapter.useIndexedDB = true;
    storageAdapter.migrationComplete = true;
    
    // 7. Registrar data da migração
    localStorage.setItem('camarim-migration-final-date', new Date().toISOString());
    
    console.log('=== MIGRAÇÃO DEFINITIVA CONCLUÍDA ===');
    console.log('O sistema agora usa apenas IndexedDB');
    console.log(`Backup salvo em: camarim-backup-pre-migration-${new Date().toISOString().slice(0,10)}.json`);
    
    return true;
}

// Executar automaticamente após 30 dias da primeira migração
function checkAndPerformFinalMigration() {
    const migrationDate = localStorage.getItem('camarim-migrated-date');
    const finalMigrationDate = localStorage.getItem('camarim-migration-final-date');
    
    // Se já fez migração final, não faz nada
    if (finalMigrationDate) {
        console.log('Migração final já realizada em:', finalMigrationDate);
        return;
    }
    
    // Se fez migração inicial há mais de 30 dias, sugere migração final
    if (migrationDate) {
        const daysDiff = (new Date() - new Date(migrationDate)) / (1000 * 60 * 60 * 24);
        
        if (daysDiff > 30) {
            if (confirm('Sistema detectou que está usando localStorage há mais de 30 dias. Deseja migrar definitivamente para IndexedDB para melhor performance e confiabilidade?')) {
                performFinalMigration().then(success => {
                    if (success) {
                        alert('Migração finalizada com sucesso! O sistema agora é mais rápido e confiável.');
                    }
                });
            }
        }
    }
}

// Adicionar ao carregamento da página
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkAndPerformFinalMigration, 5000); // Verificar após 5 segundos
});