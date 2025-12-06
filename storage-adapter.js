// storage-adapter.js - Adaptador para transição suave
class StorageAdapter {
    constructor() {
        this.useIndexedDB = false;
        this.initialized = false;
        this.migrationComplete = false;
    }
    
    async init() {
        console.log('Inicializando adaptador de storage...');
        
        // Tentar inicializar IndexedDB
        try {
            this.useIndexedDB = await databaseManager.init();
            
            if (this.useIndexedDB) {
                console.log('Usando IndexedDB como storage principal');
            } else {
                console.log('Usando localStorage como fallback');
            }
            
            this.initialized = true;
            
        } catch (error) {
            console.error('Erro ao inicializar storage:', error);
            this.useIndexedDB = false;
            this.initialized = true;
        }
    }
    
    // ============================================
    // MÉTODOS COMPATÍVEIS COM O SISTEMA ATUAL
    // ============================================
    
    async loadData() {
        if (!this.initialized) {
            await this.init();
        }
        
        if (this.useIndexedDB) {
            try {
                const data = await databaseManager.getSystemData();
                console.log('Dados carregados do IndexedDB');
                return data;
            } catch (error) {
                console.error('Erro ao carregar do IndexedDB, usando localStorage:', error);
                return this.loadFromLocalStorage();
            }
        } else {
            return this.loadFromLocalStorage();
        }
    }
    
    async saveData(data) {
        if (!this.initialized) {
            await this.init();
        }
        
        // Salvar em ambos durante a transição
        let savedToIndexedDB = false;
        
        if (this.useIndexedDB) {
            try {
                await databaseManager.saveSystemData(data);
                savedToIndexedDB = true;
                console.log('Dados salvos no IndexedDB');
            } catch (error) {
                console.error('Erro ao salvar no IndexedDB:', error);
            }
        }
        
        // Sempre manter backup no localStorage
        this.saveToLocalStorage(data);
        
        return savedToIndexedDB;
    }
    
    // ============================================
    // MÉTODOS DE FALLBACK (LOCALSTORAGE)
    // ============================================
    
    loadFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('camarim-system-data');
            
            if (savedData) {
                const data = JSON.parse(savedData);
                console.log('Dados carregados do localStorage');
                return data;
            }
            
            console.log('Nenhum dado encontrado no localStorage');
            return {
                products: [],
                sales: [],
                settings: {
                    defaultDebitFee: 2.0,
                    defaultCreditFee: 4.5,
                    defaultTax: 6,
                    defaultMargin: 40,
                    monthlyOperationalExpenses: 4000,
                    lastProductId: 0,
                    lastSaleId: 0
                }
            };
            
        } catch (error) {
            console.error('Erro ao carregar do localStorage:', error);
            return this.getDefaultData();
        }
    }
    
    saveToLocalStorage(data) {
        try {
            localStorage.setItem('camarim-system-data', JSON.stringify(data));
            console.log('Backup salvo no localStorage');
            return true;
        } catch (error) {
            console.error('Erro ao salvar no localStorage:', error);
            return false;
        }
    }
    
    getDefaultData() {
        return {
            products: [],
            sales: [],
            settings: {
                defaultDebitFee: 2.0,
                defaultCreditFee: 4.5,
                defaultTax: 6,
                defaultMargin: 40,
                monthlyOperationalExpenses: 4000,
                lastProductId: 0,
                lastSaleId: 0
            }
        };
    }
    
    // ============================================
    // MÉTODOS PARA MONITORAMENTO
    // ============================================
    
    async getStorageInfo() {
        const info = {
            usingIndexedDB: this.useIndexedDB,
            initialized: this.initialized,
            localStorage: {
                hasData: !!localStorage.getItem('camarim-system-data'),
                size: this.getLocalStorageSize()
            }
        };
        
        if (this.useIndexedDB) {
            const dbInfo = await databaseManager.getDatabaseInfo();
            info.indexedDB = dbInfo;
        }
        
        return info;
    }
    
    getLocalStorageSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length * 2; // UTF-16
            }
        }
        return total;
    }
    
    // ============================================
    // MÉTODOS DE MIGRAÇÃO ASSISTIDA
    // ============================================
    
    async forceMigration() {
        console.log('Iniciando migração forçada...');
        
        try {
            // Carregar dados do localStorage
            const data = this.loadFromLocalStorage();
            
            if (!data.products || data.products.length === 0) {
                console.log('Nenhum dado para migrar');
                return false;
            }
            
            // Salvar no IndexedDB
            await databaseManager.saveSystemData(data);
            
            // Marcar migração como completa
            this.migrationComplete = true;
            localStorage.setItem('camarim-migration-complete', 'true');
            
            console.log(`Migração completa: ${data.products.length} produtos, ${data.sales.length} vendas`);
            return true;
            
        } catch (error) {
            console.error('Erro na migração forçada:', error);
            return false;
        }
    }
    
    async cleanupLocalStorage() {
        if (this.migrationComplete || this.useIndexedDB) {
            const backupData = localStorage.getItem('camarim-system-data');
            
            if (backupData) {
                // Criar backup final
                localStorage.setItem('camarim-pre-cleanup-backup', backupData);
                localStorage.setItem('camarim-cleanup-date', new Date().toISOString());
                
                // Remover dados ativos
                localStorage.removeItem('camarim-system-data');
                
                console.log('LocalStorage limpo, backup mantido');
                return true;
            }
        }
        
        return false;
    }
}

// Instância global
const storageAdapter = new StorageAdapter();
window.CamarimStorage = storageAdapter;

export default storageAdapter;